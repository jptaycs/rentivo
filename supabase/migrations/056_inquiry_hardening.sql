-- Rentivo — Fix round 1 on 055's create_inquiry(): two hardening rulings plus
-- a replay-safety touch-up on the attach trigger. 055 is already applied to
-- the live database, so this is a NEW migration rather than an edit to 055.

-- create_inquiry() is CREATE OR REPLACE, which Postgres treats as idempotent
-- on its own — no drop needed, unlike the trigger below.
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

-- MINOR 5 (fix round 1): re-declare the attach trigger replay-safely.
-- attach_conversation_to_booking() itself is unchanged by this migration —
-- this is here purely so this file matches this project's established
-- replay-safe pattern for trigger (re)definitions (precedent: migration 037;
-- rationale: 052's header, the statement-by-statement SQL-editor replay
-- workflow). `create trigger` alone is not idempotent the way `create or
-- replace function` is, so a bare re-run of this migration in that workflow
-- would otherwise fail on "trigger already exists".
drop trigger if exists bookings_attach_conversation on public.bookings;

create trigger bookings_attach_conversation
  after insert on public.bookings
  for each row execute function public.attach_conversation_to_booking();
