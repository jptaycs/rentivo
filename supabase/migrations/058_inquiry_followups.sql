-- 058: three small follow-ups deferred by the pre-booking-inquiries final
-- review (2026-09-03), done 2026-09-04. See AGENTS.md's To Do entry.
--
--   1. A server-side length cap on message content. create_inquiry() had
--      only the client's maxLength={1000}; useConversation.send() (a direct
--      RLS-gated insert into messages) had no cap at all. A CHECK on the
--      column covers both paths; create_inquiry additionally raises a
--      readable error at the textarea's own limit so a renter sees a sentence
--      rather than a constraint violation.
--   2. attach_conversation_to_booking() now reconciles host_id when it
--      attaches an existing open inquiry to a booking. bookings.host_id is
--      set by create_booking from the locked listing row, so it is the
--      authoritative value; the conversation's copy was captured when the
--      inquiry opened and could in principle drift if a listing's host ever
--      changed in between.
--
-- Replay-safe: `create or replace`, `drop trigger if exists`, and the
-- constraint guarded by a catalog check (Postgres has no `add constraint if
-- not exists`).

-- ── 1a. Column-level cap on messages.content ─────────────────────────────
-- 4000 chars is far above anything a chat composer produces (live max at
-- authoring time: 22) and far below anything that would matter for storage;
-- the point is a bound, not a budget. ConversationView's input carries the
-- matching maxLength={4000} so a normal user never reaches this.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_content_length' and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_content_length check (length(content) <= 4000);
  end if;
end $$;

-- ── 1b. create_inquiry: readable error at the textarea's limit ───────────
-- Body is 056's verbatim, with only the length check added after the empty
-- check. 056's own comments are kept so the rationale travels with the code.
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

  insert into public.messages (conversation_id, booking_id, sender_id, content)
  values (v_convo_id, null, v_uid, trim(p_content));

  return v_convo_id;
end;
$$;

revoke execute on function public.create_inquiry(uuid, text) from public, anon;
grant  execute on function public.create_inquiry(uuid, text) to authenticated;

-- ── 2. attach_conversation_to_booking: reconcile host_id ─────────────────
-- Same shape as 055; the only change is `host_id = new.host_id` in the
-- UPDATE branch. The INSERT branch already took host_id from the booking.
create or replace function public.attach_conversation_to_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_convo_id uuid;
begin
  update public.conversations
     set booking_id = new.id,
         host_id    = new.host_id   -- 058: the booking's host is authoritative
   where listing_id = new.listing_id
     and renter_id  = new.renter_id
     and booking_id is null
  returning id into v_convo_id;

  if v_convo_id is null then
    insert into public.conversations (listing_id, renter_id, host_id, booking_id)
    values (new.listing_id, new.renter_id, new.host_id, new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_attach_conversation on public.bookings;

create trigger bookings_attach_conversation
  after insert on public.bookings
  for each row execute function public.attach_conversation_to_booking();
