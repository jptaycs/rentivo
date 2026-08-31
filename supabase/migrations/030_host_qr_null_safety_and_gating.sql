-- 030_host_qr_null_safety_and_gating.sql
-- Three cross-cutting corrections found by the host-QR feature's final review:
--
--   1. confirm_host_qr_payment's `payment_method <> 'host_qr'` guard is NULL-
--      unsafe. bookings.payment_method is nullable, and `NULL <> 'host_qr'` is
--      NULL (not true), so the guard silently did NOT fire for a NULL-method
--      booking — letting a host flip any of their own such bookings to paid
--      (and, on an instant-book listing, pending -> confirmed) via a direct
--      RPC call. Now `is distinct from`, which is NULL-safe.
--
--   2. request_payout()'s `payment_method <> 'host_qr'` exclusion (029) has the
--      same NULL problem in the opposite, money-losing direction: a NULL-method
--      booking was silently dropped from every host's payout eligibility, where
--      021 correctly included it. Also now `is distinct from`.
--
--   3. create_booking accepted p_payment_method := 'host_qr' for any listing.
--      Step3Payment's tile-visibility check is client-side only, so an
--      authenticated renter calling the RPC directly could create a host_qr
--      booking against a host who has never uploaded a QR — a booking nobody
--      can ever pay or confirm. Now server-validated against the host's
--      profiles.qr_payment_url, matching this codebase's "never trust
--      client-side state" rule for everything else create_booking computes.

-- ── 1. confirm_host_qr_payment: NULL-safe payment_method guard ──
-- Identical to 028's version except the `is distinct from` on the guard below.
create or replace function public.confirm_host_qr_payment(p_booking_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_booking public.bookings;
  v_instant boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.host_id <> auth.uid() then
    raise exception 'Only the host can confirm this payment.';
  end if;
  if v_booking.payment_method is distinct from 'host_qr' then
    raise exception 'This booking is not paid via QR.';
  end if;
  if v_booking.payment_status = 'paid' then
    return v_booking;  -- idempotent, same as mark_booking_paid
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'Cannot mark a cancelled booking as paid.';
  end if;

  select is_instant_book into v_instant
  from public.listings
  where id = v_booking.listing_id;

  update public.bookings
  set payment_status = 'paid',
      paid_at        = now(),
      status         = case
                         when coalesce(v_instant, false) and status = 'pending'
                         then 'confirmed'::booking_status
                         else status
                       end
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function public.confirm_host_qr_payment(uuid) from public, anon;
grant execute on function public.confirm_host_qr_payment(uuid) to authenticated;

-- ── 2. request_payout: NULL-safe host_qr exclusion ──
-- Identical to 029's version except `is distinct from` in the eligible CTE.
create or replace function public.request_payout()
returns public.payout_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_request public.payout_requests;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_account from public.payout_accounts where user_id = auth.uid();
  if not found or v_account.status != 'verified' then
    raise exception 'You need a verified payout account before requesting a payout.';
  end if;

  if exists (select 1 from public.payout_requests where host_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a payout request in progress.';
  end if;

  with eligible as (
    select b.id, b.rental_fee
    from public.bookings b
    where b.host_id = auth.uid()
      and b.status = 'completed'
      and b.payment_status = 'paid'
      and b.payment_method is distinct from 'host_qr'
      and not exists (
        select 1
        from public.payout_items pi
        join public.payout_requests pr on pr.id = pi.payout_request_id
        where pi.booking_id = b.id and pr.status in ('pending', 'paid')
      )
  ),
  new_request as (
    insert into public.payout_requests (host_id, payout_account_id, amount, status)
    select auth.uid(), v_account.id, coalesce(sum(eligible.rental_fee), 0), 'pending'
    from eligible
    having coalesce(sum(eligible.rental_fee), 0) > 0
    returning *
  ),
  items as (
    insert into public.payout_items (payout_request_id, booking_id, amount)
    select new_request.id, eligible.id, eligible.rental_fee
    from eligible, new_request
    returning *
  )
  select * into v_request from new_request;

  if not found then
    raise exception 'No available balance to pay out.';
  end if;

  return v_request;
end;
$$;

-- ── 3. create_booking: server-side host_qr eligibility check ──
-- Identical to 024's version (the current authoritative body) except the one
-- added guard after the listing is resolved.
create or replace function public.create_booking(
  p_listing_id       uuid,
  p_pickup_date      date,
  p_return_date      date,
  p_is_delivery      boolean default false,
  p_delivery_address text default null,
  p_payment_method   payment_method default null,
  p_renter_notes     text default null,
  p_promo_code       text default null
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  service_fee_rate    constant numeric := 0.12;
  protection_fee_rate constant numeric := 0.05;

  v_renter     uuid := auth.uid();
  v_listing    public.listings%rowtype;
  v_promo      public.promo_codes%rowtype;
  v_days       integer;
  v_rental     integer;
  v_discount   integer := 0;
  v_service    integer;
  v_protection integer;
  v_host_qr    text;
  v_booking    public.bookings;
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

  -- The checkout UI only offers the QR tile when the host has a QR on file, but
  -- that's a client-side check — enforce it here too, or a direct RPC call could
  -- create an unpayable host_qr booking against a host who accepts no such thing.
  if p_payment_method = 'host_qr' then
    select qr_payment_url into v_host_qr
    from public.profiles
    where id = v_listing.host_id;
    if v_host_qr is null then
      raise exception 'This host does not accept direct QR payment.';
    end if;
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

  v_days := p_return_date - p_pickup_date;

  if v_days >= 30 and v_listing.monthly_price is not null then
    v_rental := round(v_listing.monthly_price / 30.0 * v_days);
  elsif v_days >= 7 and v_listing.weekly_price is not null then
    v_rental := round(v_listing.weekly_price / 7.0 * v_days);
  else
    v_rental := v_listing.daily_price * v_days;
  end if;

  v_service    := round(v_rental * service_fee_rate)::integer;
  v_protection := round(v_rental * protection_fee_rate)::integer;

  if coalesce(trim(p_promo_code), '') <> '' then
    select * into v_promo
    from public.promo_codes
    where code = upper(trim(p_promo_code))
      and is_active = true
      and (valid_from  is null or now() >= valid_from)
      and (valid_until is null or now() <= valid_until)
      and (max_uses    is null or used_count < max_uses)
    for update;
    if not found then
      raise exception 'Invalid or expired promo code.';
    end if;

    -- Discount applies to the rental fee only, never the deposit
    v_discount := least(v_rental,
      coalesce(round(v_rental * v_promo.discount_pct / 100.0)::integer, 0)
      + coalesce(v_promo.discount_flat, 0));

    update public.promo_codes
    set used_count = used_count + 1
    where id = v_promo.id;
  end if;

  insert into public.bookings (
    listing_id, renter_id, host_id, pickup_date, return_date,
    rental_fee, security_deposit, service_fee, protection_fee,
    promo_code, discount, total_amount,
    status, is_delivery, delivery_address, payment_method, renter_notes
  ) values (
    p_listing_id, v_renter, v_listing.host_id, p_pickup_date, p_return_date,
    v_rental, v_listing.security_deposit, v_service, v_protection,
    v_promo.code, v_discount,
    v_rental - v_discount + v_service + v_protection + v_listing.security_deposit,
    'pending', p_is_delivery, nullif(trim(p_delivery_address), ''),
    p_payment_method, nullif(trim(p_renter_notes), '')
  )
  returning * into v_booking;

  return v_booking;
end;
$$;
