-- ============================================================
-- 045_suspension_visibility.sql
-- A suspended host's listings leave the marketplace. Enforced in the database
-- rather than only in app code, because `authenticated` holds broad grants here
-- and every public read path must agree.
--
-- create_booking is reproduced in full from 038 (the authoritative version) with
-- a single new guard added after the listing lock — this repo's convention for
-- redefining a security-definer RPC.
-- ============================================================

-- ── 1. Listings public read ──────────────────────────────────────
drop policy if exists "listings: public read active" on public.listings;
create policy "listings: public read active"
  on public.listings for select
  using (
    is_active = true
    and is_draft = false
    and not exists (
      select 1 from public.profiles p
      where p.id = listings.host_id and p.suspended_at is not null
    )
  );

-- ── 2. View counter ──────────────────────────────────────────────
-- Body from 011, with the suspension predicate added. Aliased as `l` so the
-- correlated subquery can reference the outer row unambiguously.
create or replace function public.increment_listing_view(p_listing_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.listings l
  set view_count = l.view_count + 1
  where l.id = p_listing_id
    and l.is_active = true
    and l.is_draft = false
    and not exists (
      select 1 from public.profiles p
      where p.id = l.host_id and p.suspended_at is not null
    );
$$;

revoke execute on function public.increment_listing_view(uuid) from public;
grant execute on function public.increment_listing_view(uuid) to anon, authenticated;

-- ── 3. create_booking ────────────────────────────────────────────
-- Body copied verbatim from 038 (the authoritative version — nothing after it
-- redefines this function). The ONLY change is the suspension guard marked
-- "045:", inserted immediately after the own-listing check.
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
  service_fee_rate    constant numeric := 0.05;

  v_renter     uuid := auth.uid();
  v_listing    public.listings%rowtype;
  v_promo      public.promo_codes%rowtype;
  v_days       integer;
  v_rental     integer;
  v_discount   integer := 0;
  v_service    integer;
  v_protection constant integer := 0;  -- discontinued, see 035
  v_delivery   integer := 0;           -- 038: change 1 of 4
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

  -- 045: A suspended host's gear is off the marketplace. RLS already hides it
  -- from every client read path, but this function is security definer and
  -- bypasses RLS, so without this a direct RPC call could still book a
  -- suspended host. The message deliberately matches the not-found message
  -- above — a renter has no business learning the moderation state of a
  -- stranger's account.
  if exists (
    select 1 from public.profiles p
    where p.id = v_listing.host_id and p.suspended_at is not null
  ) then
    raise exception 'Listing not found or no longer available.';
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

  -- 038: change 2 of 4 — mirrors the host_qr guard above. A NULL fee means
  -- the host never opted into delivery, so a delivery booking is invalid.
  if p_is_delivery and v_listing.delivery_fee is null then
    raise exception 'This host does not offer delivery.';
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

  -- Service fee is charged on the rental only. The delivery fee is a
  -- pass-through to the host, not a commission base.
  v_service := round(v_rental * service_fee_rate)::integer;

  -- 038: change 3 of 4 — read from the locked listing row, never a parameter.
  if p_is_delivery then
    v_delivery := coalesce(v_listing.delivery_fee, 0);
  end if;

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

  -- 038: change 4 of 4 — delivery_fee added to the column list and the total.
  insert into public.bookings (
    listing_id, renter_id, host_id, pickup_date, return_date,
    rental_fee, security_deposit, service_fee, protection_fee, delivery_fee,
    promo_code, discount, total_amount,
    status, is_delivery, delivery_address, payment_method, renter_notes
  ) values (
    p_listing_id, v_renter, v_listing.host_id, p_pickup_date, p_return_date,
    v_rental, v_listing.security_deposit, v_service, v_protection, v_delivery,
    v_promo.code, v_discount,
    v_rental - v_discount + v_service + v_protection + v_delivery + v_listing.security_deposit,
    'pending', p_is_delivery, nullif(trim(p_delivery_address), ''),
    p_payment_method, nullif(trim(p_renter_notes), '')
  )
  returning * into v_booking;

  return v_booking;
end;
$$;
