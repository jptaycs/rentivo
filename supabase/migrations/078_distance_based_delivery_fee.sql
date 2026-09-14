-- 078: distance-based delivery fee (spec 2026-09-13; plan 2026-09-14).
-- Fee = base + ceil(haversine_km × 1.3) × rate_per_km, computed ONLY in Postgres.
-- create_booking charges it and quote_delivery_fee displays it through the SAME
-- function, so the number a renter sees is the number they are charged.
--
-- Measured from the listing's PUBLIC approx_latitude/approx_longitude, never
-- the exact pin. Each whole-kilometre price step is an exact circle around the
-- origin; if the origin were the exact pin, dragging a delivery pin and
-- watching the quote step would let a renter trilaterate the host's private
-- pickup point (064/067 keep it hidden until a booking is confirmed). The
-- approximate point is already public, so its step boundaries reveal nothing.
--
-- create_booking below is the LIVE body captured with pg_get_functiondef on
-- 2026-09-14, verbatim, with exactly four changes (plus the two new trailing
-- parameters): (1) the dead host_qr guard + its v_host_qr declaration deleted
-- — it read profiles.qr_payment_url, dropped by 072, so block_host_qr_bookings'
-- own "QR Ph" message never surfaced; (2) v_road_km declared; (3) the delivery
-- computation calls delivery_fee_for; (4) three delivery columns inserted.
-- Grants afterwards match the captured ones exactly:
--   postgres, authenticated, service_role = EXECUTE (no anon, no PUBLIC).

-- Guard: the rewrite below must replace exactly the one known signature.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_booking') <> 1 then
    raise exception '078 aborted: expected exactly one create_booking overload';
  end if;
end $$;

-- ── Columns ────────────────────────────────────────────────────────────────
alter table public.listings
  add column delivery_fee_per_km integer not null default 0
    check (delivery_fee_per_km >= 0);
comment on column public.listings.delivery_fee is
  'Delivery BASE fee since 078. null = delivery not offered; 0 = no base charge.';

alter table public.bookings
  add column delivery_distance_km numeric(6,2),
  add column delivery_latitude    numeric(10,7) check (delivery_latitude  between -90  and 90),
  add column delivery_longitude   numeric(10,7) check (delivery_longitude between -180 and 180);

-- 064 revoked table-level SELECT on listings; 073/074 revoked table-level
-- INSERT/UPDATE. A new column is invisible and unwritable until granted here —
-- and a missing SELECT grant on an !inner embed empties the storefront silently.
grant select (delivery_fee_per_km) on public.listings to anon, authenticated;
grant insert (delivery_fee_per_km) on public.listings to authenticated;
grant update (delivery_fee_per_km) on public.listings to authenticated;

-- ── Internal calculator — not callable by clients ─────────────────────────
create or replace function public.delivery_fee_for(
  p_base integer, p_rate integer, p_location_is_exact boolean,
  p_from_lat numeric, p_from_lng numeric,
  p_to_lat numeric, p_to_lng numeric
) returns table (fee integer, road_km integer)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_km numeric;
  v_road integer;
begin
  if coalesce(p_rate, 0) = 0 then
    return query select coalesce(p_base, 0), null::integer;
    return;
  end if;
  if p_to_lat is null or p_to_lng is null then
    raise exception 'A delivery location is required for this listing.';
  end if;
  if p_to_lat not between -90 and 90 or p_to_lng not between -180 and 180 then
    raise exception 'The delivery location is not valid.';
  end if;
  if not coalesce(p_location_is_exact, false) or p_from_lat is null or p_from_lng is null then
    raise exception 'This host has not set an exact pickup point, so distance-based delivery is unavailable.';
  end if;
  -- Haversine. least/greatest clamp: floating point can push the acos
  -- argument a hair outside [-1, 1] for identical points, which would raise.
  v_km := 6371 * acos(least(1, greatest(-1,
      cos(radians(p_from_lat)) * cos(radians(p_to_lat))
    * cos(radians(p_to_lng) - radians(p_from_lng))
    + sin(radians(p_from_lat)) * sin(radians(p_to_lat))
  )));
  v_road := ceil(v_km * 1.3)::integer;
  return query select coalesce(p_base, 0) + v_road * p_rate, v_road;
end;
$$;
revoke all on function public.delivery_fee_for(integer, integer, boolean, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;

-- ── Quote RPC ─────────────────────────────────────────────────────────────
-- security definer so it runs independently of the caller's column grants and
-- can read the listing's pricing and pin-provenance flag. Returns only the fee
-- and rounded road kilometres, never coordinates.
create or replace function public.quote_delivery_fee(
  p_listing_id uuid, p_delivery_lat numeric, p_delivery_lng numeric
) returns table (fee integer, road_km integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing record;
begin
  select l.delivery_fee, l.delivery_fee_per_km, l.location_is_exact, l.approx_latitude, l.approx_longitude
    into v_listing
  from public.listings l
  where l.id = p_listing_id and l.is_active and not l.is_draft
    and not public.is_host_suspended(l.host_id);
  if not found then
    raise exception 'Listing not found or no longer available.';
  end if;
  if v_listing.delivery_fee is null then
    raise exception 'This host does not offer delivery.';
  end if;
  return query
    select q.fee, q.road_km
    from public.delivery_fee_for(v_listing.delivery_fee, v_listing.delivery_fee_per_km,
      v_listing.location_is_exact, v_listing.approx_latitude, v_listing.approx_longitude,
      p_delivery_lat, p_delivery_lng) q;
end;
$$;
revoke all on function public.quote_delivery_fee(uuid, numeric, numeric) from public, anon;
grant execute on function public.quote_delivery_fee(uuid, numeric, numeric) to authenticated;

-- ── create_booking rewrite ────────────────────────────────────────────────
drop function public.create_booking(uuid, date, date, boolean, text, payment_method, text, text);

CREATE FUNCTION public.create_booking(p_listing_id uuid, p_pickup_date date, p_return_date date, p_is_delivery boolean DEFAULT false, p_delivery_address text DEFAULT NULL::text, p_payment_method payment_method DEFAULT NULL::payment_method, p_renter_notes text DEFAULT NULL::text, p_promo_code text DEFAULT NULL::text, p_delivery_lat numeric DEFAULT NULL::numeric, p_delivery_lng numeric DEFAULT NULL::numeric)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_road_km    integer;                -- 078
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
  -- 078: base + distance, from the listing's PUBLIC approx point (never the
  -- exact pin), through the same function quote_delivery_fee uses.
  if p_is_delivery then
    select q.fee, q.road_km into v_delivery, v_road_km
    from public.delivery_fee_for(v_listing.delivery_fee, v_listing.delivery_fee_per_km,
      v_listing.location_is_exact, v_listing.approx_latitude, v_listing.approx_longitude,
      p_delivery_lat, p_delivery_lng) q;
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
    status, is_delivery, delivery_address, payment_method, renter_notes,
    delivery_distance_km, delivery_latitude, delivery_longitude
  ) values (
    p_listing_id, v_renter, v_listing.host_id, p_pickup_date, p_return_date,
    -- 070: deposit is no longer charged; stored 0 like protection_fee (035).
    v_rental, 0, v_service, v_protection, v_delivery,
    -- 071: no promo is recorded and no discount is applied.
    null, 0,
    v_rental + v_service + v_protection + v_delivery,
    'pending', p_is_delivery, nullif(trim(p_delivery_address), ''),
    p_payment_method, nullif(trim(p_renter_notes), ''),
    -- 078: a flat-fee delivery stores no coordinates — nothing needed them.
    case when p_is_delivery then v_road_km end,
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lat end,
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end
  )
  returning * into v_booking;

  return v_booking;
end;
$function$
;

-- Restore the exact captured EXECUTE grants: postgres (owner), authenticated,
-- service_role. A new function gets EXECUTE for PUBLIC by default (and anon
-- via Supabase default privileges), neither of which the old one had.
revoke all on function public.create_booking(uuid, date, date, boolean, text, payment_method, text, text, numeric, numeric)
  from public, anon;
grant execute on function public.create_booking(uuid, date, date, boolean, text, payment_method, text, text, numeric, numeric)
  to authenticated, service_role;
