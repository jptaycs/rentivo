-- ============================================================
-- Rentivo — Server-side booking creation
-- All amounts are computed here from the listing row, so a
-- tampered client cannot underpay. Direct INSERTs on bookings
-- are revoked from authenticated; this RPC is the only path.
-- ============================================================

create or replace function public.create_booking(
  p_listing_id       uuid,
  p_pickup_date      date,
  p_return_date      date,
  p_is_delivery      boolean default false,
  p_delivery_address text default null,
  p_payment_method   payment_method default null,
  p_renter_notes     text default null
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  service_fee_rate    constant numeric := 0.12;
  protection_fee_rate constant numeric := 0.05;

  v_renter     uuid := auth.uid();
  v_listing    public.listings%rowtype;
  v_days       integer;
  v_rental     integer;
  v_service    integer;
  v_protection integer;
  v_status     booking_status;
  v_booking    public.bookings;
  d            date;
begin
  if v_renter is null then
    raise exception 'You must be signed in to book.';
  end if;

  -- Lock the listing row so concurrent bookings serialize on it
  select * into v_listing
  from public.listings
  where id = p_listing_id and is_active = true and is_draft = false
  for update;
  if not found then
    raise exception 'Listing not found or no longer available.';
  end if;
  if v_listing.host_id = v_renter then
    raise exception 'You cannot book your own listing.';
  end if;

  if p_pickup_date < current_date then
    raise exception 'Pickup date cannot be in the past.';
  end if;
  if p_return_date <= p_pickup_date then
    raise exception 'Return date must be after the pickup date.';
  end if;
  if p_is_delivery and coalesce(trim(p_delivery_address), '') = '' then
    raise exception 'A delivery address is required for delivery.';
  end if;

  if exists (
    select 1 from public.availability_blocks
    where listing_id = p_listing_id
      and blocked_on between p_pickup_date and p_return_date - 1
  ) then
    raise exception 'The selected dates are no longer available.';
  end if;

  v_days       := p_return_date - p_pickup_date;
  v_rental     := v_listing.daily_price * v_days;
  v_service    := round(v_rental * service_fee_rate)::integer;
  v_protection := round(v_rental * protection_fee_rate)::integer;
  v_status     := case when v_listing.is_instant_book
                       then 'confirmed'::booking_status
                       else 'pending'::booking_status end;

  insert into public.bookings (
    listing_id, renter_id, host_id, pickup_date, return_date,
    rental_fee, security_deposit, service_fee, protection_fee, total_amount,
    status, is_delivery, delivery_address, payment_method, renter_notes
  ) values (
    p_listing_id, v_renter, v_listing.host_id, p_pickup_date, p_return_date,
    v_rental, v_listing.security_deposit, v_service, v_protection,
    v_rental + v_service + v_protection + v_listing.security_deposit,
    v_status, p_is_delivery, nullif(trim(p_delivery_address), ''),
    p_payment_method, nullif(trim(p_renter_notes), '')
  )
  returning * into v_booking;

  -- Instant Book confirms immediately; the availability trigger only
  -- fires on UPDATE, so block the dates here
  if v_status = 'confirmed' then
    d := p_pickup_date;
    while d < p_return_date loop
      insert into public.availability_blocks (listing_id, blocked_on, reason)
      values (p_listing_id, d, 'booked')
      on conflict (listing_id, blocked_on) do nothing;
      d := d + 1;
    end loop;
  end if;

  return v_booking;
end;
$$;

revoke execute on function public.create_booking(uuid, date, date, boolean, text, payment_method, text) from public, anon;
grant execute on function public.create_booking(uuid, date, date, boolean, text, payment_method, text) to authenticated;

-- Amounts must come from the RPC — no more direct inserts
revoke insert on public.bookings from authenticated;
