-- Rentivo — The only path that creates a conversation, plus booking attach.

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
    select count(*) into v_recent
      from public.conversations c
     where c.renter_id = v_uid
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

-- ── Attach an open inquiry to a new booking ────────────────────────────────
--
-- A TRIGGER, deliberately, rather than editing create_booking(). That
-- function's body has been reproduced across several migrations and each
-- reproduction is a chance to disturb the amounts logic, which has already
-- caused two security incidents in this repo. This achieves the same result
-- without reopening that file.

create or replace function public.attach_conversation_to_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_convo_id uuid;
begin
  update public.conversations
     set booking_id = new.id
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

create trigger bookings_attach_conversation
  after insert on public.bookings
  for each row execute function public.attach_conversation_to_booking();
