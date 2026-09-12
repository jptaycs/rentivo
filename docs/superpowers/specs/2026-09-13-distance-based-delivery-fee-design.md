# Distance-based delivery fee — design

**Date:** 2026-09-13
**Status:** approved, not yet implemented

## 1. Problem

A host who offers delivery sets one flat fee for every destination. Delivering
across the same barangay and delivering to the next city cost the host very
different amounts of time and fuel, and the flat fee can only ever be wrong in
one direction or the other — too cheap for the far renter, too expensive for
the near one.

This adds a per-kilometre component: the host sets what they charge to set out
and what they charge per kilometre, the renter says where they want it, and the
fee follows the actual distance.

## 2. Decisions

Each of these was chosen deliberately; the alternatives are recorded because
the reasons matter more than the choices.

### 2.1 Fee shape: base + per-km

`fee = base + ceil(road_km) × rate_per_km`

`listings.delivery_fee` **is repurposed as the base fee**. Its existing
semantics are unchanged and this is the whole reason for reusing it rather than
adding a differently-named column:

| Value | Meaning (unchanged) |
|-------|---------------------|
| `null` | host does not offer delivery |
| `0` | delivery offered, no base charge |
| `> 0` | delivery offered, this much before distance |

Every existing check — `Step2Pickup`'s `listing.delivery_fee !== null`,
`create_booking`'s "This host does not offer delivery" guard, the wizard, the
edit page — keeps working untouched. A new `listings.delivery_fee_per_km`
carries the rate.

Rejected: a `delivery_mode` enum with flat and per-km branches. It doubles the
states in the wizard, the checkout, the pricing mirror and `create_booking`,
and every one of those four is money code. Base-plus-rate expresses a flat fee
as `rate = 0`, so the flat case survives as a special case of the general one
rather than as a separate code path.

**Live data this must absorb:** of 27 listings, exactly one sets a delivery fee
(DJI Osmo Pocket 3, ₱100). Under the new model it becomes base ₱100, rate ₱0 —
identical behaviour, no data migration beyond the column default.

### 2.2 Suggested rates

The wizard's placeholders will be **₱100 base + ₱20/km**, and both are only
placeholders — the host sets whatever they want.

The brief suggested ₱100 per kilometre. That is placed on the base instead,
because Philippine courier pricing runs roughly ₱50–60 base plus ₱8–15/km
(Lalamove, Grab), and ₱100/km would price a 10km delivery at ₱1,000 — more than
most daily rental rates on this marketplace. A fee that exceeds the rental it
accompanies will simply stop delivery being chosen.

### 2.3 Distance: haversine × 1.3, rounded up

Straight-line distance between the two points, multiplied by 1.3 to approximate
road distance, rounded up to the whole kilometre.

Rejected: a routing API (OSRM, Google, Mapbox). It would add a per-booking
network call inside the booking transaction, a new `connect-src` CSP origin, and
for the hosted options a bill and an account — this project has deliberately
avoided paid map services throughout (it runs Leaflet on free Esri tiles and a
static PH city table precisely to avoid geocoding costs). The 1.3 factor is the
standard detour-index approximation for urban road networks; it will be wrong
in specific cases (a river crossing, EDSA at rush hour) and that is accepted.

Rounding **up** is deliberate: it favours the host, who bears the real cost, and
avoids a 0km fee for a destination across the street.

### 2.4 Computed server-side, from the locked listing row

`create_booking` gains `p_delivery_lat` and `p_delivery_lng`. It computes the
distance and the fee itself, from the listing row it already locks, and writes
the result. **The client never sends a fee or a distance.**

This is not ceremony. This repo has a documented incident (AGENTS.md, migration
040) where booking amounts were client-mutable: a legitimate ₱2,490 booking was
edited to `total_amount = 1` with nothing but the public anon key, and the
checkout route would then have charged ₱1 on live keys. Amounts are derived
where the renter cannot reach them, or they are not trustworthy.

The renter *does* supply the destination coordinates, and that is unavoidable —
the destination is their own choice and there is no independent source for it.
The residual exposure is bounded and in the renter's disfavour: pinning a point
nearer than the true address understates the fee they pay, and the host sees
both the typed address and the pin before accepting. A renter who lies about
the pin is asking the host to deliver somewhere the host did not price, and the
host can decline.

### 2.5 Per-km requires a host-placed pin

Per-km pricing is offered **only when `listings.location_is_exact` is true**.

Of 27 live listings, only 2 have a host-placed pin; the other 25 carry
city-centre coordinates from migration 066's backfill. Charging per kilometre
measured from the centre of Naga City, when the gear is 4km away, invents a
number and presents it as a measurement. Listings without a real pin keep the
flat base fee they have today.

`create_booking` enforces this: a listing with `delivery_fee_per_km > 0` and
`location_is_exact = false` raises rather than quietly pricing from a
backfilled point.

### 2.6 Renter flow: address *and* pin

Choosing Delivery reveals the existing address textarea **plus** a map pin,
reusing `LocationPicker` from the host wizard (same Leaflet stack, same
`ssr: false` dynamic-import rule). The quoted fee updates as the pin moves.

Both are required because they answer different questions: the typed address is
where the host physically goes, including unit and floor, which no coordinate
carries; the pin is what the fee is computed from.

### 2.7 No distance cap

Chosen explicitly. The fee simply grows with distance.

**Known consequence, accepted:** on an Instant Book listing, a renter can pin a
destination 200km away and the booking auto-confirms on payment. The host's
recourse is to cancel, which refunds the renter in full (`refundBooking()`).
Without Instant Book the booking sits `pending` and the host simply declines.

### 2.8 Privacy

The renter's delivery coordinates are personal data about where they live or
work. `src/lib/account-deletion.ts` already nulls `bookings.delivery_address`;
the two new coordinate columns must be nulled in the same update. AGENTS.md
carries a standing obligation that every new personal-data column is added to
that module, and nothing enforces it automatically.

## 3. Data model

### 3.1 `listings`

```sql
alter table public.listings
  add column delivery_fee_per_km integer not null default 0
    check (delivery_fee_per_km >= 0);
```

`delivery_fee` keeps its type, nullability and meaning (now: the base fee).

**Grant, and it is load-bearing:** migration 064 revoked table-level `select` on
`listings` and granted an explicit column list. A new column is private by
default, so `grant select (delivery_fee_per_km)` must be issued in the same
migration or every storefront read that names it returns 403 — and because five
public read paths use `!inner` embeds, a missing grant shows up as a *silently
empty storefront*, not an error.

`src/lib/listing-columns.ts`'s `LISTING_COLUMNS` must gain the column too.

### 3.2 `bookings`

```sql
alter table public.bookings
  add column delivery_distance_km numeric(6,2),
  add column delivery_latitude    numeric(10,7),
  add column delivery_longitude   numeric(10,7);
```

All three are written only by `create_booking`. No grant is needed: table-level
`insert` on `bookings` is revoked from both roles (007, 039, 040), so the
security-definer RPC is the only writer, and the existing row-level select
policy already scopes reads to the booking's two parties.

`delivery_distance_km` is stored, not recomputed for display, so a receipt shows
the distance the fee was actually based on even if the listing later moves.

## 4. `create_booking`

A new migration copies the function body **verbatim from 071** — the current
authoritative version — and changes only the delivery block. This copying
discipline is not optional: two of this repo's documented security incidents
(038/039, 040) came from edits to this function that disturbed logic nobody was
looking at.

New parameters, both defaulted so no existing caller breaks:

```
p_delivery_lat numeric default null,
p_delivery_lng numeric default null
```

Delivery block, replacing `v_delivery := coalesce(v_listing.delivery_fee, 0)`:

```sql
if p_is_delivery then
  -- Base fee always applies; per-km applies on top.
  v_delivery := coalesce(v_listing.delivery_fee, 0);

  if coalesce(v_listing.delivery_fee_per_km, 0) > 0 then
    if p_delivery_lat is null or p_delivery_lng is null then
      raise exception 'A delivery location is required for this listing.';
    end if;
    if not v_listing.location_is_exact then
      raise exception 'This host has not set an exact pickup point, so distance-based delivery is unavailable.';
    end if;
    if v_listing.latitude is null or v_listing.longitude is null then
      raise exception 'This listing has no pickup coordinates.';
    end if;

    -- Haversine, clamped: floating point can push the acos argument a hair
    -- outside [-1, 1] for identical points, which would raise.
    v_km := 6371 * acos(least(1, greatest(-1,
        cos(radians(v_listing.latitude)) * cos(radians(p_delivery_lat))
      * cos(radians(p_delivery_lng) - radians(v_listing.longitude))
      + sin(radians(v_listing.latitude)) * sin(radians(p_delivery_lat))
    )));
    v_km_road := ceil(v_km * 1.3);
    v_delivery := v_delivery + (v_km_road * v_listing.delivery_fee_per_km);
  end if;
end if;
```

Unchanged and deliberately so:

- the service fee is still computed on the rental alone — delivery is a
  pass-through to the host, not a commission base;
- `request_payout()` already pays `rental_fee + delivery_fee`, so a larger
  delivery fee reaches the host with no change;
- the "host does not offer delivery" guard (`delivery_fee is null`) is untouched;
- the delivery address remains required for any delivery booking.

## 5. Client mirror

`src/lib/pricing.ts` gains the same arithmetic for display. It is a mirror, not
a source: the number the renter is charged is whatever `create_booking`
computed, and the checkout already re-reads the stored booking before paying.

```ts
export function deliveryKm(from: Coords, to: Coords): number   // haversine × 1.3, ceil
export function calcDeliveryFee(listing, to: Coords | null): number
```

`calcPricing()` takes an optional destination and uses it when present.

## 6. UI

| Surface | Change |
|---|---|
| Host wizard, Step 3 Pricing | "Delivery base fee" (existing field, relabelled) + new "Per kilometre" field, shown only when a base fee is entered. Per-km input disabled with an explanation when the listing has no exact pin. |
| Listing edit page | Same two fields. |
| `Step2Pickup` (checkout) | Delivery tile shows "from ₱X" when a rate is set. Choosing delivery reveals the address field plus the map picker; fee and distance update live. |
| `OrderSummary` | Delivery row shows the distance: "Delivery (7 km)". |
| `Step4Confirmation` receipt | Same, from the stored `delivery_distance_km`. |

## 7. Verification

A script under `scripts/verify/`, following the established pattern: throwaway
host, renter and listing; real sessions for every authorisation claim; service
role only for setup, independent re-reads and cleanup.

1. **The arithmetic** — listing pinned at a known point, booking created with a
   destination at a known distance; assert the stored fee equals
   `base + ceil(haversine × 1.3) × rate` computed independently in JS, and that
   `delivery_distance_km` matches.
2. **Server-side authority** — the RPC ignores anything fee-shaped the client
   sends; a booking's stored `delivery_fee` cannot be PATCHed afterwards
   (should still fail with `permission denied for table bookings`, per 040).
3. **Refusals, each with a control proving the same call succeeds without the
   condition under test:** missing pin with a rate set; `location_is_exact`
   false with a rate set; delivery on a listing with `delivery_fee is null`.
4. **Backward compatibility** — a listing with `rate = 0` charges exactly the
   base fee, with or without a pin, matching today's behaviour; the one live
   flat-fee listing is unaffected.
5. **Payout** — `request_payout()` includes the full distance-based fee.
6. **Deletion** — the delivery coordinates are nulled by account deletion.
7. **Storefront grant** — the `!inner` embed still returns all active listings
   after the new column is added (catches a missing `grant select`).

## 8. Out of scope

- Road routing, traffic, or delivery time estimates.
- Per-km pricing for listings without a host-placed pin (they keep flat fees).
- Backfilling exact pins for the 25 legacy listings — a separate decision, since
  it means asking real hosts to place a pin.
- Any change to who pays the service fee on delivery: it remains uncharged.

## 9. Risks

- **Detour factor is an approximation.** 1.3 is a reasonable urban average and
  will be wrong for specific journeys. Hosts can raise their base to compensate.
- **No cap** means an Instant Book listing can auto-confirm an unreasonable
  delivery; see 2.7.
- **A renter can understate distance** by pinning short; bounded by the host
  seeing both address and pin before accepting, and it costs the renter a
  delivery to the wrong place.
