-- 075: make message image attachments private.
--
-- 019 created `message-images` as a PUBLIC bucket with a read policy of
-- `using (bucket_id = 'message-images')` for every role. That exposed private
-- renter/host DM attachments to the whole internet two independent ways:
--   1. a public bucket is served at /storage/v1/object/public/<bucket>/<path>
--      WITHOUT evaluating RLS at all — anyone with the URL gets the file;
--   2. the read policy itself granted SELECT to anon, so even the
--      authenticated object API / signing endpoint would hand it out.
-- 019's own comment ("URLs are unguessable and only surface inside
-- RLS-protected conversations") was the whole defence: an unguessable URL is
-- a bearer token that never expires and can be forwarded, logged or scraped.
--
-- Found by the 2026-09-13 security audit (MEDIUM-3) while the bucket held 0
-- objects and no message carried an image, so there is nothing to migrate.
-- The guard below makes that assumption load-bearing rather than hopeful.
--
-- The app now stores the STORAGE PATH (`<sender uid>/<uuid>.<ext>`) in
-- messages.image_url instead of a public URL, and renders through short-lived
-- signed URLs (createSignedUrls), which the storage API only issues when this
-- migration's SELECT policy allows the caller to read the object.

-- ── Guard: refuse to run if real attachments appeared since the audit ──────
-- Any object whose name is not the current `<uuid>/<uuid>.<ext>` shape, or any
-- message whose image_url is not a bare path of that shape, would be silently
-- orphaned (unrenderable) by this change. Stop instead.
do $$
declare
  v_bad_objects int;
  v_bad_messages int;
begin
  select count(*) into v_bad_objects
  from storage.objects
  where bucket_id = 'message-images'
    and name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpe?g|png|webp|avif)$';

  select count(*) into v_bad_messages
  from public.messages
  where image_url is not null
    and image_url !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpe?g|png|webp|avif)$';

  if v_bad_objects > 0 or v_bad_messages > 0 then
    raise exception
      '075 aborted: % message-images object(s) and % message row(s) do not match the new path shape — migrate them first',
      v_bad_objects, v_bad_messages;
  end if;
end $$;

-- ── 1. Private bucket ──────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'message-images';

-- ── 2. messages.image_url now holds a storage path, not a URL ──────────────
-- No rename: the column name is referenced across the app and there is no
-- data to move. The CHECK is defence in depth for the read policy below: a
-- message may only reference an object in its OWN SENDER's folder, so nobody
-- can "attach" a path they learned from another conversation and thereby gain
-- read access to it for a third party. It also means a client can no longer
-- store an arbitrary URL for the other party's browser to fetch.
comment on column public.messages.image_url is
  'Storage path in the private message-images bucket, shaped <sender uid>/<uuid>.<ext> (since 075; was a public URL before). Render via a signed URL, never directly.';

alter table public.messages
  add constraint messages_image_path_shape check (
    image_url is null
    or (
      image_url ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpe?g|png|webp|avif)$'
      and split_part(image_url, '/', 1) = sender_id::text
    )
  );

-- ── 3. Read policy ─────────────────────────────────────────────────────────
drop policy if exists "message-images: public read" on storage.objects;

-- Why a security-definer helper instead of an inline subquery: a subquery in a
-- policy's USING clause runs with the INVOKER's privileges, so messages' and
-- conversations' own RLS would apply inside it. It happens to give the right
-- answer today, but the answer would then silently change whenever either
-- table's policies are edited — the exact trap migration 046 recorded for
-- is_host_suspended(). The helper fixes the question being asked ("is this
-- caller a party to a conversation containing a message that attaches this
-- object?") independently of those policies. It returns only a boolean about
-- the caller's own access, so it discloses nothing the caller could not
-- already learn by trying to sign the object.
create or replace function public.can_read_message_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.image_url = p_name
        -- the attaching message must come from the folder's owner (mirrors the
        -- CHECK above, so the policy stays correct even if that constraint is
        -- ever dropped)
        and m.sender_id::text = split_part(p_name, '/', 1)
        and auth.uid() in (c.renter_id, c.host_id)
    );
$$;

revoke all on function public.can_read_message_image(text) from public;
revoke all on function public.can_read_message_image(text) from anon;
grant execute on function public.can_read_message_image(text) to authenticated;

create policy "message-images: uploader or conversation party read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-images'
    and (
      -- the uploader: needed in the window between upload and the message row
      -- existing, and so a sender always sees their own attachment
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_read_message_image(name)
    )
  );

-- "message-images: own folder write" (INSERT) and "message-images: own folder
-- delete" (DELETE) from 019 are correct and deliberately unchanged.
