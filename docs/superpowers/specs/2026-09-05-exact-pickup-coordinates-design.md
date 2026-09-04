# Exact pickup coordinates + floating listing cards on the maps

**Status:** approved design, not yet implemented
**Date:** 2026-09-05

## Problem

Two requests, one from the marketplace owner:

1. A host should be able to **pick the exact pickup point on a map** when creating a
   listing, instead of the location being derived from a city dropdown.
2. On the renter side the map should show **the camera's name and image as a floating
   card**, not a blue pin.

Today `PickupMap` and `SearchMap` both pin at a **city centre** looked up from
`src/lib/ph-locations.ts`. `listings.latitude`/`longitude` have existed since migration
001 (`numeric(10,7)`) but are **null on all 25 listings** and are deliberately unused.

## The privacy decision this reverses, and what replaces it

`AGENTS.md` carries a standing rule: *"don't wire [latitude/longitude] into any
public-facing map without a privacy review, since unlike the city lookup they could hold
an exact address."* The renter-facing copy on the map says *"exact pickup address is
shared after your booking is confirmed."* And `latitude`/`longitude` are absent from
`LISTING_COLUMNS`, the allowlist that exists because `select('*')` twice leaked private
data to anonymous visitors (`street_address`, then `qr_payment_label`).

Most hosts here rent a camera from home, so an exact public pin is a home address,
visible to anyone browsing, before any booking exists.

**Decision (owner, 2026-09-05): hosts set an exact point; the public sees an approximate
location; the exact point is revealed once a booking is confirmed.** The on-page promise
stays true, and precision is available where it is actually useful.

## Decisions taken

| Question | Choice | Consequence |
|---|---|---|
| Who sees the exact point | Approximate publicly, exact after a confirmed booking | Requires split public/private columns |
| Floating cards | **One card per listing on both maps, no collision handling** | Cards will overlap where listings cluster (most are in Metro Manila). Owner was shown this and chose it. |
| Is a pin required | **Required for all listings, with a backfill** | Blocks publishing until placed; 25 existing rows need values |

### Backfill without inventing data

"Required for all" needs the 25 existing listings to have coordinates. They will be
backfilled from `getCityCoordinates()` — **the same city-centre value the map already
displays for them today**. Nothing is fabricated; the pin each listing already shows is
simply materialised into the column.

That creates a trap: a backfilled row would otherwise look as precise as a host-placed
one. So `location_is_exact boolean not null default false` records which is which, and no
UI claims precision for a row where it is false. This is the migration-023 mistake
(guessed data presented as real) deliberately not repeated.

## Data model

- `listings.latitude` / `longitude` — existing `numeric(10,7)`. Backfilled, then `NOT NULL`.
  **Order matters: backfill script first, constraint second.** The reverse fails on 25 rows.
- `listings.location_is_exact boolean not null default false` — true only when a host
  placed the pin.
- `listings.approx_latitude` / `approx_longitude` — **generated** columns, exact rounded to
  **2 decimal places** (~1.1 km grid at PH latitudes). Deterministic, so repeated reads
  cannot triangulate a finer position.

  **3 decimal places was the first choice and is wrong.** It shifts a point by at most
  ~77 m, so publishing it would disclose the host's location to within a house — the exact
  outcome this design exists to prevent, dressed up as "approximate". 2 dp shifts by up to
  ~775 m, which is genuinely approximate while still telling a renter which part of Metro
  Manila the camera is in — far more useful than today's single city pin.

## Exposure

- `LISTING_COLUMNS` gains **only** `approx_latitude`, `approx_longitude`,
  `location_is_exact`. Exact coordinates never enter it.
- Exact `latitude`/`longitude` get the migration-059 treatment: `revoke select` from
  `anon`/`authenticated`, so a raw PostgREST call cannot read them. Per 040's finding, a
  table-level grant satisfies any column, so the revoke must come first.
- Exact coordinates are readable only through a `security definer` RPC scoped to a
  **party to a confirmed booking** on that listing.
- A **1 km** public circle is drawn at the rounded point. Rounding to 2 dp moves a point by
  at most ~775 m, so the true location is provably inside the circle — the circle is an
  honest claim, not decoration. Circle radius and rounding are coupled: change one and the
  other stops being true.

## Host picker

Step 5 of the host wizard (which already collects province and city) and the listing edit
page. Leaflet via the existing `ssr: false` dynamic-import rule — `PickupMapLeaflet` is the
pattern to follow, and must not be imported directly into a Server Component. The map opens
at the city centre for the chosen province/city; click or drag places the marker; placing it
sets `location_is_exact = true`. Required before publishing.

## Renter rendering

- **Listing page** — the blue pin is replaced by a floating card showing the listing image
  and name at the approximate point, with the 1 km circle beneath it. Copy updated to say
  the area is approximate until a booking is confirmed.
- **Search map** — changes from **one marker per city** to **one card per listing**. This is
  a larger visual change than swapping an icon, and is the direct consequence of choosing
  one card per listing. No collision handling: hover raises a card's z-index so an
  overlapped card is still clickable, which is legibility, not de-collision.
- Both maps keep taking their tile URL from `src/lib/map-tiles.ts` (Esri World Topo). Note
  Esri's `{z}/{y}/{x}` ordering — swapping row and column serves the wrong place silently.

## Testing

Live, against the hosted database, throwaway accounts only:

1. Backfill: every listing's stored coordinate equals `getCityCoordinates()` for its
   province/city, and `location_is_exact` is false for all 25.
2. A host placing a pin sets `location_is_exact = true` and stores what was placed.
3. Exact coordinates: unreadable by `anon` and by a signed-in stranger (42501); readable
   through the RPC by a party to a confirmed booking; refused for a pending booking.
4. `approx_*` readable publicly; the published value verified to differ from exact by up to
   ~775 m and never to be the exact value; the drawn circle verified to contain the exact
   point.
5. Both maps rendered on a production build: card renders with image and name, circle
   present, zero console errors, tiles loading.
6. Regression: `LISTING_COLUMNS` consumers still work; the storefront `!inner` host joins
   still return rows (the trap recorded against narrowing `profiles`).

## Non-goals

- Collision handling / clustering on the search map. Explicitly declined by the owner.
- Geocoding a typed address. The picker is manual; there is no geocoding API here and
  `ph-locations.ts` exists precisely to avoid one.
- Changing what `ph-locations.ts` does. It remains the fallback and the wizard's initial
  centre.

## Risks

- **Publishing is now blocked on placing a pin**, including on a poor connection. This
  wizard already has a documented history of partial-submit failures; the picker must not
  make an unrecoverable state worse.
- **Cards will overlap** where listings cluster. Accepted by the owner.
- **Exact coordinates are new PII on `listings`.** Per the standing obligation in
  `AGENTS.md`, `src/lib/account-deletion.ts` must be updated: a deleted host's exact
  coordinates need clearing, in the same pass that de-addresses their listings.
