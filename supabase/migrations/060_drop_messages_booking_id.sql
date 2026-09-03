-- 060: drop messages.booking_id.
--
-- Deferred since the pre-booking-inquiries work (051's header said "Task 11
-- removes this trigger together with the booking_id column"). The column has
-- been dead weight since 053 moved messages' RLS onto conversation_id: the
-- app reads a thread's booking through conversations.booking_id, the email
-- recipient is resolved through the conversation (src/lib/email.ts), the
-- composer inserts only conversation_id, and the Realtime filter is on
-- conversation_id. The only writers left were the 051/052/054 shim trigger
-- (which derived one column from the other for pre-migration clients) and
-- create_inquiry, which inserted an explicit null.
--
-- What goes, in dependency order:
--   1. the shim trigger + function (it reads/writes the column);
--   2. create_inquiry redefined without the column (058's body, one line
--      changed) — a function body referencing a dropped column fails at
--      call time, not at drop time, so this must precede the drop;
--   3. the index, then the column (its FK to bookings goes with it).
--
-- Pre-flight: refuse to run if any message's booking_id disagrees with its
-- conversation's. 054 made a mismatch structurally impossible, so this
-- should be a no-op — it is here so that, if that belief is ever wrong, the
-- migration stops instead of silently discarding the only copy of a fact.
--
-- Deleting a booking still deletes its messages: conversations.booking_id
-- cascades (049) and messages.conversation_id cascades (051), so the chain
-- bookings → conversations → messages replaces the direct FK dropped here.
--
-- Old-shape inserts ({booking_id, sender_id, content} with no
-- conversation_id) stop working here — PostgREST rejects an unknown column.
-- No shipped client has sent that shape since 2026-09-03.

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.booking_id is distinct from c.booking_id;
  if v_bad > 0 then
    raise exception '060 aborted: % message(s) have booking_id inconsistent with their conversation', v_bad;
  end if;
end $$;

-- ── 1. Shim trigger ──────────────────────────────────────────────────────
drop trigger if exists messages_fill_conversation on public.messages;
drop function if exists public.fill_conversation_from_booking();

-- ── 2. create_inquiry without the column (058 body, insert line changed) ──
create or replace function public.create_inquiry(
  p_listing_id uuid,
  p_content    text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  -- The 24h cap. A guess, not a measurement — there is no traffic data behind
  -- it. Deliberately one constant so it is a one-line change.
  v_max_per_day constant integer := 10;
  -- 058: matches InquiryDialog's textarea maxLength. The CHECK constraint on
  -- messages.content (4000) is the real bound; this one exists so the error a
  -- renter sees is a sentence, not "violates check constraint".
  v_max_length  constant integer := 1000;
  v_uid       uuid := auth.uid();
  v_listing   record;
  v_convo_id  uuid;
  v_recent    integer;
begin
  if v_uid is null then
    raise exception 'You must be signed in to message a host.';
  end if;

  -- RULING B (fix round 1): guard the CALLER's own suspension, not just the
  -- listing's host. is_host_suspended() only ever tests
  -- `profiles.suspended_at is not null` despite its name, so it works for any
  -- user id, renter or host. Middleware only covers page loads; a direct
  -- PostgREST RPC call from a suspended renter's still-live access token
  -- (up to ~1h after suspension) would otherwise sail straight through.
  if public.is_host_suspended(v_uid) then
    raise exception 'Your account is suspended. You cannot start new conversations — contact support.';
  end if;

  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'Message cannot be empty.';
  end if;

  if length(trim(p_content)) > v_max_length then
    raise exception 'Message is too long — please keep it under % characters.', v_max_length;
  end if;

  -- Host comes off the listing row, never from a client parameter.
  select l.id, l.host_id, l.is_active, l.is_draft
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found then
    raise exception 'Listing not found.';
  end if;
  if v_listing.is_draft or not v_listing.is_active then
    raise exception 'This listing is not available.';
  end if;
  if v_listing.host_id = v_uid then
    raise exception 'You cannot message yourself about your own listing.';
  end if;
  -- A suspended host is off the marketplace; messaging them would be a channel
  -- around that.
  if public.is_host_suspended(v_listing.host_id) then
    raise exception 'This listing is not available.';
  end if;

  -- Reuse an existing OPEN inquiry, so a double-submit is harmless. This also
  -- means the partial unique index is never actually hit by normal use.
  select c.id into v_convo_id
    from public.conversations c
   where c.listing_id = p_listing_id
     and c.renter_id  = v_uid
     and c.booking_id is null;

  if v_convo_id is null then
    -- RULING A (fix round 1): only UNATTACHED conversations count toward the
    -- cap. Before this, a renter's own real BOOKINGS counted toward a cap
    -- whose error message says "started too many new conversations today" —
    -- false and unexplainable if a legitimate repeat-renter ever tripped it.
    -- Excluding attached rows doesn't weaken the anti-spam property: a
    -- spammer's inquiries stay booking_id is null unless they actually book.
    select count(*) into v_recent
      from public.conversations c
     where c.renter_id = v_uid
       and c.booking_id is null
       and c.created_at > now() - interval '24 hours';

    if v_recent >= v_max_per_day then
      raise exception 'You have started too many new conversations today. Please try again tomorrow.';
    end if;

    insert into public.conversations (listing_id, renter_id, host_id)
    values (p_listing_id, v_uid, v_listing.host_id)
    returning id into v_convo_id;
  end if;

  -- 060: messages.booking_id is gone; the thread's booking lives on the
  -- conversation row only.
  insert into public.messages (conversation_id, sender_id, content)
  values (v_convo_id, v_uid, trim(p_content));

  return v_convo_id;
end;
$$;

revoke execute on function public.create_inquiry(uuid, text) from public, anon;
grant  execute on function public.create_inquiry(uuid, text) to authenticated;

-- ── 3. Index, then the column (FK messages_booking_id_fkey goes with it) ──
drop index if exists public.messages_booking_idx;
alter table public.messages drop column if exists booking_id;
