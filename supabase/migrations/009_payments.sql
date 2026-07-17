-- ============================================================
-- Rentivo — Payment lifecycle (PayMongo)
--
-- Bookings are now created unpaid + pending. Payment confirmation
-- comes only from the server (webhook / redirect verification)
-- via mark_booking_paid, which is service_role-only. Availability
-- blocking moves to the status transition to 'confirmed', which
-- the existing booking_confirmed_block trigger already handles.
-- Promo codes are validated and applied server-side.
-- ============================================================

alter table public.bookings
  add column promo_code text,
  add column discount   integer not null default 0,
  add column paid_at    timestamptz;

-- Webhooks look bookings up by payment intent id
create index bookings_paymongo_ref_idx on public.bookings(paymongo_ref);

-- Promo codes referenced across the UI
insert into public.promo_codes (code, discount_pct) values
  ('RENTIVO10', 10),
  ('WELCOME15', 15),
  ('CREATOR20', 20)
on conflict (code) do nothing;

-- ───────────────────────────────────────────────────────────
-- create_booking v2: adds promo support, and no longer confirms
-- or blocks availability up front — that now happens on payment.
-- ───────────────────────────────────────────────────────────

drop function if exists public.create_booking(uuid, date, date, boolean, text, payment_method, text);

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

  v_days       := p_return_date - p_pickup_date;
  v_rental     := v_listing.daily_price * v_days;
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

revoke execute on function public.create_booking(uuid, date, date, boolean, text, payment_method, text, text) from public, anon;
grant execute on function public.create_booking(uuid, date, date, boolean, text, payment_method, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────
-- mark_booking_paid: the only path to payment_status = 'paid'.
-- Called by the server (webhook or redirect verification) with
-- the service role after PayMongo confirms the charge. Idempotent.
-- Instant Book listings confirm immediately; the status update
-- fires booking_confirmed_block, which blocks the dates.
-- ───────────────────────────────────────────────────────────

create or replace function public.mark_booking_paid(
  p_booking_id  uuid,
  p_paymongo_ref text default null
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_booking public.bookings;
  v_instant boolean;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.payment_status = 'paid' then
    return v_booking;  -- webhook + redirect verification can race
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'Cannot mark a cancelled booking as paid.';
  end if;

  select is_instant_book into v_instant
  from public.listings
  where id = v_booking.listing_id;

  update public.bookings
  set payment_status = 'paid',
      paymongo_ref   = coalesce(p_paymongo_ref, paymongo_ref),
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

revoke execute on function public.mark_booking_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_booking_paid(uuid, text) to service_role;
