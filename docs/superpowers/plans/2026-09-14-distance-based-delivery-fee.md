# Distance-Based Delivery Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host charge a base delivery fee plus a per-kilometre rate, and charge renters for the actual distance between the host's pickup pin and a delivery pin the renter drops at checkout.

**Architecture:** One internal Postgres function computes the fee from the host's *public approximate* pin (see Amendment 2 — measuring from the exact pin would let the price steps trilaterate it) and the renter's pin. It is called by `create_booking` (which charges) and by a new `quote_delivery_fee` RPC (which the checkout UI displays), so the number shown is always the number charged. The client never computes or sends a fee.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS, Leaflet (existing `LocationPicker`), PayMongo.

**Spec:** `docs/superpowers/specs/2026-09-13-distance-based-delivery-fee-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **Fee:** `base + ceil(haversine_km × 1.3) × rate_per_km`. `listings.delivery_fee` is the base and keeps its meaning: `null` = no delivery, `0` = no base charge, `> 0` = base. New `listings.delivery_fee_per_km integer not null default 0 check (>= 0)`.
- **Per-km requires a host-placed pin:** `delivery_fee_per_km > 0` is only chargeable when `location_is_exact = true`. `create_booking` raises otherwise; the UI disables the field.
- **Service fee is NOT charged on delivery.** It stays computed on the rental alone. `request_payout()` already pays `rental_fee + delivery_fee` and needs no change.
- **No distance cap** (spec §2.7, accepted).
- **Placeholder rates in the host UI:** base `100`, per km `20`. Placeholders only — never pre-filled values.
- **Amendment 1 to the spec — a server quote, not a client mirror.** The spec's §5 had the client mirror the arithmetic. A single server function is the only way to guarantee the number shown is the number charged, so **the UI displays the value returned by the `quote_delivery_fee` RPC, never a client computation.** The RPC returns the fee and rounded road kilometres only, never coordinates.
- **Amendment 2 to the spec — measure from the host's PUBLIC approximate point, not the exact one. This is a privacy requirement, not a preference.** The fee is `ceil(km × 1.3)`, so every whole-kilometre step is an exact circle around the origin point. If that origin were the host's exact pin, a renter could drag a delivery pin and watch where the quoted price steps, locate points on several of those circles, and trilaterate the host's exact pickup location — the very point 064/067 keep private until a booking is confirmed. Measuring from `approx_latitude`/`approx_longitude` (the GENERATED columns rounded to 3dp, ~108m, already public to everyone) means the step boundaries reveal nothing that isn't already published. The accuracy cost is at most ~77m of offset × 1.3, which cannot move a per-kilometre price by more than one step in rare edge cases. **Both `quote_delivery_fee` and `create_booking` use the approximate point**, so quote and charge still agree exactly. `location_is_exact = true` is still required: the approximate point is only meaningful when derived from a host-placed pin rather than a city-centre backfill.
- **Privacy:** renter delivery coordinates are personal data. They go into `src/lib/account-deletion.ts` in the same change (standing obligation in AGENTS.md).
- **`create_booking` rewrite discipline.** Its live signature is
  `(p_listing_id uuid, p_pickup_date date, p_return_date date, p_is_delivery boolean, p_delivery_address text, p_payment_method payment_method, p_renter_notes text, p_promo_code text)`.
  Adding parameters changes the signature, so the old function must be **dropped** (a second overload would make PostgREST calls ambiguous) and the new one re-granted exactly as before. Copy the body **verbatim from `pg_get_functiondef` on the live database**, not from a migration file. Change only what is listed in Task 1. Two of this repo's security incidents (038/039, 040) came from careless copies of this function.
- **In the same rewrite, delete the dead `host_qr` branch** (`if p_payment_method = 'host_qr' then select qr_payment_url …`). It reads a column migration 072 dropped. TODO.md records that it must be removed *in* this rewrite and not separately. Once it is gone, `scripts/verify/072-retire-host-qr-and-billing.mjs`'s deliberately-failing assertion should start passing, because the `block_host_qr_bookings` trigger's own message now surfaces.
- **Migrations 073–077 are live and must keep working:** column-level INSERT and UPDATE grants on `listings` (073/074) need the new column added or host saves 403; `bookings` carries `bookings_rate_limit` (076) and `bookings_guard_insert` (077) triggers; `messages`/`reviews`/`verification_requests` have narrowed INSERT grants (077).
- **Never touch** host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68`, booking `RNT-A4DA55`, or any real user's rows. Throwaway accounts use `@example.com` and are deleted afterwards.
- **Verification convention:** scripts in `scripts/verify/*.mjs` using `./env.mjs`; real sessions via `signIn`/`asUser` for every authorisation claim; service role only for setup, re-reads and cleanup; every refusal paired with a control; distinguish `permission denied` from a silent zero-row result. Browser checks run on port **3100** (never 3000).
- Every task ends with `npx tsc --noEmit && npm run lint && npm run build` clean.

---

### Task 1: Migration 078 — schema, fee function, quote RPC, `create_booking` rewrite

**Files:**
- Create: `supabase/migrations/078_distance_based_delivery_fee.sql`
- Create: `scripts/verify/078-distance-based-delivery-fee.mjs`
- Modify: `src/lib/account-deletion.ts` (null the new booking coordinate columns alongside `delivery_address`)
- Modify: `src/types/index.ts` (add the new columns)
- Modify: `src/lib/listing-columns.ts` (add `delivery_fee_per_km` to `LISTING_COLUMNS`)

**Interfaces:**
- Produces: column `listings.delivery_fee_per_km integer`; columns `bookings.delivery_distance_km numeric(6,2)`, `bookings.delivery_latitude numeric(10,7)`, `bookings.delivery_longitude numeric(10,7)`.
- Produces: `public.quote_delivery_fee(p_listing_id uuid, p_delivery_lat numeric, p_delivery_lng numeric) returns table (fee integer, road_km integer)`, `security definer`, executable by `authenticated` only.
- Produces: `create_booking(p_listing_id uuid, p_pickup_date date, p_return_date date, p_is_delivery boolean, p_delivery_address text, p_payment_method payment_method, p_renter_notes text, p_promo_code text, p_delivery_lat numeric default null, p_delivery_lng numeric default null)`.
- Produces (TS): `Listing.delivery_fee_per_km: number`; `Booking.delivery_distance_km: number | null`, `Booking.delivery_latitude: number | null`, `Booking.delivery_longitude: number | null`.

- [ ] **Step 1: Capture the live `create_booking` body and its grants**

```bash
cd /Users/jptaycs/Documents/GitHub/rentivo
supabase db query --linked "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_booking';" > /tmp/create_booking_live.json
supabase db query --linked "select grantee, privilege_type from information_schema.routine_privileges where routine_schema='public' and routine_name='create_booking';"
```

Record the grantees. The new function must end with exactly the same EXECUTE grants.

- [ ] **Step 2: Write the verification script first**

Create `scripts/verify/078-distance-based-delivery-fee.mjs`. It must fail before the migration, because the new RPC and columns do not exist yet. Required checks, each refusal with its control:

```js
// Proves: the fee is computed server-side from the host's exact pin; the quote
// and the charge agree; per-km is refused without a host-placed pin; no-delivery
// listings still refuse delivery; flat-fee behaviour is unchanged; coordinates
// never leak through the quote; the dead host_qr branch is gone.
//
// Usage: node --experimental-strip-types scripts/verify/078-distance-based-delivery-fee.mjs
import { admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'

// Independent JS implementation of the fee rule — the oracle the database is
// checked against. Deliberately separate code, so a shared bug can't pass.
function expectedFee({ base, rate, fromLat, fromLng, toLat, toLng }) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(toLat - fromLat)
  const dLng = toRad(toLng - fromLng)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2
  const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
  const roadKm = Math.ceil(km * 1.3)
  return { fee: base + roadKm * rate, roadKm }
}
```

The script then, using a throwaway verified host + renter + listing (service role for setup):

1. **Quote equals charge** — listing pinned at a known point (e.g. `13.6218, 123.1948`, Naga City) with `delivery_fee = 100`, `delivery_fee_per_km = 20`, `location_is_exact = true`. Renter quotes a pin ~5 km away via `rpc/quote_delivery_fee`, then calls `rpc/create_booking` with the same pin. Assert `quote.fee === booking.delivery_fee === expectedFee(...).fee` **where the oracle's origin is the listing's `approx_latitude`/`approx_longitude` read back via service role**, and `booking.delivery_distance_km` equals the rounded road km.
1b. **Measured from the approximate point, not the exact one** — choose a destination where `ceil(km × 1.3)` differs between the exact pin and the approx point (search a few candidate points in the script until one differs). Assert the charged fee matches the **approx**-origin oracle and not the exact-origin one. This is the check that proves the trilateration protection is real.
2. **Quote leaks no coordinates** — assert the quote response object's keys are exactly `fee` and `road_km`.
3. **Service fee unchanged by delivery** — `booking.service_fee === round(rental_fee × 0.05)`, and `total_amount === rental_fee + service_fee + delivery_fee`.
4. **No pin + per-km refused** — set `location_is_exact = false` on the probe listing; `create_booking` with delivery raises the per-km error. **Control:** set `delivery_fee_per_km = 0` on the same listing and the same call succeeds, charging exactly the base.
5. **Missing destination refused** — per-km listing, delivery, no `p_delivery_lat`: raises. **Control:** with coordinates it succeeds.
6. **Out-of-range coordinates refused** — `p_delivery_lat = 200`: raises.
7. **No delivery offered still refused** — `delivery_fee = null`, delivery requested: raises "This host does not offer delivery." **Control:** pickup on the same listing succeeds.
8. **Pickup ignores coordinates** — `p_is_delivery = false` with coordinates supplied: `delivery_fee = 0`, `delivery_distance_km` and both coordinate columns null.
9. **Client cannot forge the fee afterwards** — renter `PATCH bookings?id=eq.<id> {delivery_fee: 1}` → `permission denied for table bookings`.
10. **Host cannot forge the rate as an unexpected column** — host `PATCH listings {delivery_fee_per_km: 30}` on their own listing **succeeds** (it's a legitimate host setting), and anon `PATCH` changes nothing.
11. **Quote is authenticated-only** — anon `rpc/quote_delivery_fee` → 401.
12. **Dead host_qr branch gone** — `create_booking` with `p_payment_method: 'host_qr'` raises the trigger's message containing `QR Ph`, **not** a `42703`/`column "qr_payment_url" does not exist` error.
13. **Exactly one overload** — `select count(*) from pg_proc where proname = 'create_booking'` is `1`.
14. **Grants restored** — the `routine_privileges` for `create_booking` equal those captured in Step 1.
15. **Regressions** — re-run `074`, `075`, `076`, `077` scripts from within this script's instructions (or in Step 7) and require all to pass.

Cleanup: delete every probe booking (and the notifications its triggers wrote), the probe listing, `rate_limit_hits` rows for the probe users, and the throwaway users; re-read to prove each is gone. Check the forbidden host and `RNT-A4DA55` are untouched.

- [ ] **Step 3: Run it to confirm it fails**

```bash
node --experimental-strip-types scripts/verify/078-distance-based-delivery-fee.mjs
```

Expected: FAIL — `quote_delivery_fee` does not exist (404/PGRST202) and `delivery_fee_per_km` is an unknown column.

- [ ] **Step 4: Write migration 078**

Create `supabase/migrations/078_distance_based_delivery_fee.sql`. Structure, in this order:

```sql
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
```

Then the internal calculator — not callable by clients:

```sql
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
```

The quote RPC — `security definer` so it runs independently of the caller's column grants and can read the listing's pricing and pin-provenance flag. It measures from the public approximate point (Amendment 2) and returns only the fee and kilometres:

```sql
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
```

Then the `create_booking` rewrite:

```sql
drop function public.create_booking(uuid, date, date, boolean, text, payment_method, text, text);

create function public.create_booking(
  p_listing_id uuid,
  p_pickup_date date,
  p_return_date date,
  p_is_delivery boolean default false,
  p_delivery_address text default null,
  p_payment_method payment_method default null,
  p_renter_notes text default null,
  p_promo_code text default null,
  p_delivery_lat numeric default null,
  p_delivery_lng numeric default null
) ...
```

**The body is the live body captured in Step 1, verbatim, with only these four changes.** Preserve every original default exactly as captured — if a captured parameter has no default, give it none; the defaults above are illustrative of shape, not values to invent.

1. **Delete** the `host_qr` guard: the whole `if p_payment_method = 'host_qr' then … end if;` block and its `v_host_qr` declaration.
2. **Declare** `v_road_km integer;`.
3. **Replace** the delivery computation (`v_delivery := coalesce(v_listing.delivery_fee, 0);` inside `if p_is_delivery then`) with:

```sql
  if p_is_delivery then
    select q.fee, q.road_km into v_delivery, v_road_km
    from public.delivery_fee_for(v_listing.delivery_fee, v_listing.delivery_fee_per_km,
      v_listing.location_is_exact, v_listing.approx_latitude, v_listing.approx_longitude,
      p_delivery_lat, p_delivery_lng) q;
  end if;
```

   The locked `v_listing` row must include `delivery_fee_per_km`, `location_is_exact`, `approx_latitude`, `approx_longitude`. If the captured body selects `*` it already does; if it names columns, add these. **Use the `approx_*` columns, never `latitude`/`longitude`** — see Amendment 2.

4. **Add** `delivery_distance_km, delivery_latitude, delivery_longitude` to the `insert into public.bookings` column list, with values `case when p_is_delivery then v_road_km end`, `case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km,0) > 0 then p_delivery_lat end`, `case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km,0) > 0 then p_delivery_lng end`. A flat-fee delivery stores no coordinates — nothing needed them.

Everything else — service fee on the rental alone, tier pricing, the "does not offer delivery" guard, the delivery-address-required guard, suspension checks, `security definer`, `search_path` — is unchanged. Finish with the EXECUTE grants recorded in Step 1, exactly.

- [ ] **Step 5: Apply**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

Expected: `078` present locally and remotely.

- [ ] **Step 6: Data-layer edits**

`src/types/index.ts` — in `Listing` add `delivery_fee_per_km: number`; in `Booking` add `delivery_distance_km: number | null`, `delivery_latitude: number | null`, `delivery_longitude: number | null`.

`src/lib/listing-columns.ts` — append `, delivery_fee_per_km` to `LISTING_COLUMNS`.

`src/lib/account-deletion.ts` — the update that sets `delivery_address: null` also sets `delivery_latitude: null, delivery_longitude: null`, with a comment that renter delivery coordinates are personal data. Fix `src/lib/mock-data.ts` so every mock listing has `delivery_fee_per_km: 0` (tsc will require it).

- [ ] **Step 7: Run the script and the regressions**

```bash
node --experimental-strip-types scripts/verify/078-distance-based-delivery-fee.mjs
for s in 074-fix-availability-and-listings-insert 075-private-message-images 076-rate-limiting 077-booking-lifecycle-and-insert-hardening 072-retire-host-qr-and-billing; do
  echo "== $s"; node --experimental-strip-types scripts/verify/$s.mjs 2>&1 | tail -2
done
npx tsc --noEmit && npm run lint && npm run build
```

Expected: 078 all pass; 074–077 all pass; **072 now passes in full** (its previously-failing check was the dead branch). If 072's comment describes that check as expected-to-fail, update the comment.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/078_distance_based_delivery_fee.sql scripts/verify/078-distance-based-delivery-fee.mjs src/lib/account-deletion.ts src/types/index.ts src/lib/listing-columns.ts src/lib/mock-data.ts scripts/verify/072-retire-host-qr-and-billing.mjs
git commit -m "Compute delivery fees from distance in Postgres (migration 078)"
```

---

### Task 2: Host UI — per-km rate in the wizard and edit page

**Files:**
- Modify: `src/components/host/Step3Pricing.tsx`
- Modify: `src/components/host/ListingWizard.tsx`
- Modify: `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `listings.delivery_fee_per_km` (Task 1), writable by the host.
- Produces: `PricingData.deliveryFeePerKm: string` in the wizard state.

- [ ] **Step 1: Wizard state and insert**

In `ListingWizard.tsx`, extend `pricing` with `deliveryFeePerKm: string` (initial `''`) and add to the insert payload:

```ts
delivery_fee_per_km: pricing.deliveryFee === '' ? 0 : Number(pricing.deliveryFeePerKm || 0),
```

A listing that offers no delivery stores `0`, never a stray rate.

- [ ] **Step 2: Step3Pricing field**

In `Step3Pricing.tsx`, relabel the existing delivery field **"Delivery base fee"**, and under it render a **"Per kilometre"** field only when a base fee has been entered (`data.deliveryFee !== ''`). Placeholders: base `100`, per km `20`. Help text, verbatim:

> Renters are charged the base fee plus this rate for every kilometre between your pickup point and their delivery address, measured as road distance. Leave it at 0 to charge only the base fee.

Validation: per-km must be a whole number ≥ 0. New wizard listings always get an exact pin at Step 5, so the field is enabled here.

- [ ] **Step 3: Edit page**

In the edit page, load `delivery_fee_per_km`, show the same two fields, save `delivery_fee_per_km`. **Disable** the per-km field when the listing's `location_is_exact` is false, with this text:

> Set your exact pickup point on the map below first — distance-based delivery needs it to measure how far the renter is.

Clearing the base fee (no delivery) saves `delivery_fee_per_km: 0`.

- [ ] **Step 4: Verify in the browser**

Build, serve on 3100, sign in as the demo host through the real login form with Playwright. On the wizard's pricing step enter base `100`, per km `20`, and complete the wizard **including clicking two blocked dates** (the path 073 once broke). Confirm in the database that the new listing has `delivery_fee = 100`, `delivery_fee_per_km = 20`, and that its two `availability_blocks` rows exist. On a legacy listing without an exact pin, confirm the edit page shows the per-km field disabled. Delete the probe listing and prove it is gone.

- [ ] **Step 5: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add src/components/host/Step3Pricing.tsx src/components/host/ListingWizard.tsx "src/app/(main)/dashboard/listings/[id]/edit/page.tsx"
git commit -m "Let hosts set a per-kilometre delivery rate"
```

---

### Task 3: Checkout — delivery pin, server quote, charge

**Files:**
- Create: `src/hooks/useDeliveryQuote.ts`
- Modify: `src/components/booking/Step2Pickup.tsx`
- Modify: `src/components/booking/BookingWizard.tsx`
- Modify: `src/components/booking/OrderSummary.tsx`
- Modify: `src/components/booking/Step4Confirmation.tsx`
- Modify: `src/lib/pricing.ts`
- Modify: `src/app/api/payments/checkout/route.ts`

**Interfaces:**
- Consumes: `rpc/quote_delivery_fee(p_listing_id, p_delivery_lat, p_delivery_lng) → [{ fee, road_km }]`; `create_booking(..., p_delivery_lat, p_delivery_lng)` (Task 1).
- Produces: `useDeliveryQuote(listingId: string, pin: { lat: number; lng: number } | null, enabled: boolean) → { fee: number | null; roadKm: number | null; loading: boolean; error: string | null }`.
- Produces: `calcPricing(listing, days, isDelivery, deliveryFeeOverride?: number | null)`.

- [ ] **Step 1: `pricing.ts` takes the quoted fee**

Change `calcPricing` so a delivery booking uses the quoted fee when one is supplied, and the base fee otherwise:

```ts
export function calcPricing(
  listing: PricedListing,
  days: number,
  isDelivery = false,
  deliveryFeeOverride: number | null = null
) {
  const { rentalFee, tier } = calcRentalFee(listing, days)
  const serviceFee = Math.round(rentalFee * SERVICE_FEE_RATE)
  const deliveryFee = isDelivery ? (deliveryFeeOverride ?? listing.delivery_fee ?? 0) : 0
  const total = rentalFee + serviceFee + deliveryFee
  return { rentalFee, tier, serviceFee, deliveryFee, total }
}
```

Update its doc comment: the delivery figure for a per-km listing comes from `quote_delivery_fee`, never from client arithmetic, because exact coordinates are not visible to the client.

- [ ] **Step 2: `useDeliveryQuote`**

```ts
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * The server's delivery fee for a renter's pin. Debounced: dragging a pin fires
 * many changes. The quote is computed in Postgres by the same function
 * create_booking charges with, so what this returns is what the renter pays.
 */
export function useDeliveryQuote(
  listingId: string,
  pin: { lat: number; lng: number } | null,
  enabled: boolean
) {
  const [state, setState] = useState<{ fee: number | null; roadKm: number | null; loading: boolean; error: string | null }>(
    { fee: null, roadKm: null, loading: false, error: null }
  )

  useEffect(() => {
    if (!enabled || !pin) {
      setState({ fee: null, roadKm: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    const t = setTimeout(async () => {
      const { data, error } = await createClient().rpc('quote_delivery_fee', {
        p_listing_id: listingId,
        p_delivery_lat: pin.lat,
        p_delivery_lng: pin.lng,
      })
      if (cancelled) return
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row) {
        setState({ fee: null, roadKm: null, loading: false, error: error?.message ?? 'Could not price delivery.' })
      } else {
        setState({ fee: row.fee, roadKm: row.road_km, loading: false, error: null })
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [listingId, pin?.lat, pin?.lng, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}
```

- [ ] **Step 3: `Step2Pickup` — pin + quote**

Add props `deliveryPin: { lat: number; lng: number } | null`, `onPinChange(p)`, and `quote` (the hook's state). When delivery is selected **and** `listing.delivery_fee_per_km > 0`, render the existing `LocationPicker` (from `src/components/host/LocationPicker`) below the address field, centred on `listing.city`/`listing.province`, with a line under it:

- loading → "Calculating delivery…"
- quoted → "Delivery: ₱{fee} ({roadKm} km by road)"
- error → the server's message, in red

The delivery tile shows `from ₱{base}` when a per-km rate is set, the base otherwise, "Free" at `0` with no rate. `canContinue` for a per-km delivery also requires a pin **and** a successful quote (`quote.fee !== null && !quote.loading`). The address field stays required: the pin prices the trip, the address is where the host goes.

- [ ] **Step 4: `BookingWizard` — state, reuse, and the call**

Add `deliveryPin` state, call `useDeliveryQuote(listing.id, deliveryPin, isDelivery && listing.delivery_fee_per_km > 0)`, pass `quote.fee` into `OrderSummary` as the override, and send `deliveryLat`/`deliveryLng` in the checkout body.

**The booking-reuse guard must include the pin.** `BookingWizard` already refuses to reuse a booking created under a different pickup/delivery choice (`bookingIdDelivery`), because reusing it would charge the old total. Extend the same rule to the pin: record the pin a booking was created with, and create a new booking when it changes — otherwise a renter who moves the pin after a first attempt pays for the old distance.

- [ ] **Step 5: Checkout route**

In `src/app/api/payments/checkout/route.ts`, accept `deliveryLat?: number | null` and `deliveryLng?: number | null`. Validate that each is a finite number in range or absent; reject anything else with 400. Pass them to `create_booking` as `p_delivery_lat`/`p_delivery_lng`, only when `isDelivery`. **Do not accept or forward a fee.** The route prices the PayMongo intent from the stored `total_amount`, which is now server-computed from the pin. The booking-reuse branch must not reuse a booking whose stored `delivery_latitude`/`delivery_longitude` differ from the request (mirrors Step 4).

- [ ] **Step 6: Summary and receipt**

`OrderSummary`: when a quoted distance exists, label the row "Delivery ({roadKm} km)". `Step4Confirmation`: when `booking.delivery_distance_km` is set, label "Delivery ({km} km)" from the **stored** value, so the receipt shows the distance actually charged.

- [ ] **Step 7: Build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useDeliveryQuote.ts src/components/booking/Step2Pickup.tsx src/components/booking/BookingWizard.tsx src/components/booking/OrderSummary.tsx src/components/booking/Step4Confirmation.tsx src/lib/pricing.ts src/app/api/payments/checkout/route.ts
git commit -m "Price delivery from the renter's pin at checkout"
```

---

### Task 4: End-to-end verification and docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `TODO.md`

- [ ] **Step 1: Drive checkout in a real browser**

Setup via service role: set one demo host listing to `delivery_fee = 100`, `delivery_fee_per_km = 20`, `location_is_exact = true`, with a known exact pin. Record its previous values so they can be restored exactly.

Build, serve on 3100, sign in as the demo renter through the real login form. Open `/book?listing=<id>&from=<future>&to=<future+2>`. Choose Delivery, type an address, click the map at a point several kilometres from the pin. Confirm:
- the quote line shows a fee and kilometres;
- the Order Summary's delivery row and total use that same fee;
- moving the pin changes the quote;
- the payment step's total equals the summary's total.

Stop **before paying** — no real money. Verify the server agrees by calling `rpc/create_booking` with the same pin as the demo renter and asserting its `delivery_fee` equals the fee displayed in the browser. Delete that booking and its notifications.

- [ ] **Step 2: Restore and clean up**

Restore the demo listing's delivery columns to their recorded values. Delete every probe row, and the `rate_limit_hits` rows the probes created. Re-read to prove each is gone.

- [ ] **Step 3: Docs**

`AGENTS.md`, in the Booking lifecycle section: delivery is now base + per-km; the fee is computed only in Postgres by `delivery_fee_for`, shared by `create_booking` and `quote_delivery_fee`; per-km requires `location_is_exact`; renter delivery coordinates are purged on account deletion; `create_booking` was re-created with two new parameters and its dead `host_qr` branch removed. Record the spec amendment (server quote instead of a client mirror) and why.

`TODO.md`: mark the "Next phase must delete the dead `host_qr` branch in `create_booking`" item done. Add a short done entry for distance-based delivery, including that only listings with a host-placed pin can use it, and that today only a small number do.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md TODO.md
git commit -m "Record distance-based delivery and the create_booking rewrite"
```

---

## Self-Review

**Spec coverage:** §2.1 fee shape → Task 1 Step 4 (`delivery_fee_for`); §2.2 placeholder rates → Task 2 Step 2; §2.3 haversine × 1.3 ceil → `delivery_fee_for`, independently checked by the script's JS oracle; §2.4 server-side from locked row → Task 1 Step 4 change 3; §2.5 per-km needs a pin → `delivery_fee_for` raise + Task 2 Step 3 disabled field; §2.6 address and pin → Task 3 Step 3; §2.7 no cap → no cap anywhere; §2.8 privacy → Task 1 Step 6; §3 data model → Task 1 Step 4; §4 `create_booking` → Task 1 Steps 1 and 4; §5 client mirror → **amended** to a server quote (Global Constraints, Task 3); §6 UI table → Tasks 2 and 3; §7 verification → Task 1 Step 2 and Task 4.

**Placeholders:** none — the one body not reproduced inline is `create_booking`'s, which must be copied from the live database by instruction, with the four edits specified exactly.

**Type consistency:** `quote_delivery_fee` returns `(fee integer, road_km integer)` in Task 1 and is read as `row.fee` / `row.road_km` in Task 3. `delivery_fee_per_km` has the same name in SQL, types, `LISTING_COLUMNS`, wizard insert and edit page. `calcPricing`'s fourth parameter is `deliveryFeeOverride` in both its definition and its call.
