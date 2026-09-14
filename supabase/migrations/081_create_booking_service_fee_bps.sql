-- 081: create_booking charges and stamps the admin-set service fee
-- (spec 2026-09-14 §4.1; plan 2026-09-14).
--
-- The rate is read HERE, in create_booking, not stamped by a before-insert
-- trigger. A trigger would read the setting in a DIFFERENT statement from the
-- one that computed the fee; under READ COMMITTED an admin change committing
-- between the two would stamp one rate on a fee computed at another. The rate
-- must be read once and used twice — which is exactly what v_fee_bps does.
--
-- The body below is pg_get_functiondef's output for the live function, pasted
-- verbatim, with four hunks applied. CREATE OR REPLACE on the unchanged
-- signature keeps the existing ACL (postgres, authenticated, service_role), so
-- this migration deliberately issues NO grant.
--
-- pg_get_functiondef emits no statement terminator; the lone `;` after
-- $function$ below is that terminator and is NOT part of the definition.

do $$
declare v_md5 text;
begin
  if (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_booking') <> 1 then
    raise exception '081 aborted: expected exactly one create_booking overload';
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_booking';

  if v_md5 <> 'ec309539300d75e69a905942b49fa484' then
    raise exception '081 aborted: create_booking is not the body this migration was written against (found md5 %). Re-capture with pg_get_functiondef, re-derive the four hunks against the new body, update this guard, and only then apply.', v_md5;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.create_booking(p_listing_id uuid, p_pickup_date date, p_return_date date, p_is_delivery boolean DEFAULT false, p_delivery_address text DEFAULT NULL::text, p_payment_method payment_method DEFAULT NULL::payment_method, p_renter_notes text DEFAULT NULL::text, p_promo_code text DEFAULT NULL::text, p_delivery_lat numeric DEFAULT NULL::numeric, p_delivery_lng numeric DEFAULT NULL::numeric)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- 081: the admin-set platform rate (080). Read ONCE, so the fee charged and
  -- the rate stamped on the row are the same value by construction.
  v_fee_bps           constant integer := public.current_service_fee_bps();
  service_fee_rate    constant numeric := v_fee_bps / 10000.0;

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

  -- 038: change 2 of 4. A NULL fee means
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
    delivery_distance_km, delivery_latitude, delivery_longitude,
    service_fee_bps
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
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end,
    v_fee_bps
  )
  returning * into v_booking;

  return v_booking;
end;
$function$
;
