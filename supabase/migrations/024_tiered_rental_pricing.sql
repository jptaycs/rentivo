-- ============================================================
-- Rentivo — Apply weekly/monthly discount pricing in create_booking
--
-- Listings have always had optional weekly_price/monthly_price
-- columns, but create_booking only ever used daily_price * days.
-- This switches the rental fee to the listing's cheaper duration
-- tier once a rental crosses 7 or 30 days, when the host has set
-- that tier's price. Everything downstream (service fee, protection
-- fee, promo discount, total) already derives from v_rental, so no
-- other change is needed.
-- ============================================================

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
