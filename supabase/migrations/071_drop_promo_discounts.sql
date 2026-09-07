-- ============================================================
-- 071_drop_promo_discounts.sql
-- Promo codes are discontinued.
--
-- WHY: a discount reduced what the RENTER paid but not what the HOST was paid.
-- request_payout() pays rental_fee + delivery_fee (046:105) and rental_fee is
-- stored PRE-discount, so Rentivo's net on a discounted booking was
-- `service_fee - discount`. With a 5% service fee, every code was loss-making:
--   RENTIVO10 (10%) -> -5% of rental      WELCOME15 (15%) -> -10% of rental
--   CREATOR20 (20%) -> -15% of rental
-- All three were live on production with max_uses null (unlimited) and
-- valid_until null (never expiring), seeded 2026-07-17. They were deactivated
-- (is_active = false) before this migration ran.
--
-- create_booking is reproduced VERBATIM from 070_drop_security_deposit_charge.sql
-- (the authoritative version) with exactly three changes, all marked `071:`
-- below. AGENTS.md records two security incidents caused by careless
-- reproduction of this function (038/039, 040) — diff this against 070 before
-- applying.
--
-- bookings.promo_code and bookings.discount are KEPT and unchanged, so the four
-- bookings that already used a code keep their real historical values and their
-- receipts still add up. Same reasoning as 035 (protection_fee) and 070
-- (security_deposit). public.promo_codes is likewise left in place.
--
-- p_promo_code stays in the signature deliberately: dropping a parameter breaks
-- every caller at once, including any client build still deployed. It is simply
-- ignored.
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

  -- 071: promo codes are discontinued. p_promo_code is still accepted so no
  -- caller's signature breaks, but it is IGNORED — never looked up, never
  -- redeemed, and it never reduces the amount. A discount came out of
  -- Rentivo's own margin, not the host's: the host is paid rental_fee (stored
  -- PRE-discount, 046:105), so net was service_fee - discount, i.e. NEGATIVE
  -- for any code above the 5% service fee. Every code that existed was 10-20%.

  -- 038: change 4 of 4 — delivery_fee added to the column list and the total.
  insert into public.bookings (
    listing_id, renter_id, host_id, pickup_date, return_date,
    rental_fee, security_deposit, service_fee, protection_fee, delivery_fee,
    promo_code, discount, total_amount,
    status, is_delivery, delivery_address, payment_method, renter_notes
  ) values (
    p_listing_id, v_renter, v_listing.host_id, p_pickup_date, p_return_date,
    -- 070: deposit is no longer charged; stored 0 like protection_fee (035).
    v_rental, 0, v_service, v_protection, v_delivery,
    -- 071: no promo is recorded and no discount is applied.
    null, 0,
    v_rental + v_service + v_protection + v_delivery,
    'pending', p_is_delivery, nullif(trim(p_delivery_address), ''),
    p_payment_method, nullif(trim(p_renter_notes), '')
  )
  returning * into v_booking;

  return v_booking;
end;
$$;


-- The redemption RPC is dead surface now that nothing applies a discount.
-- Revoke rather than leave an authenticated-callable function nobody uses.
revoke execute on function public.validate_promo_code(text) from authenticated;
