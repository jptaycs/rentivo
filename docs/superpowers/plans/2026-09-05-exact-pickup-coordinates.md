# Exact Pickup Coordinates + Floating Listing Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host place the exact pickup point on a map, show the public an approximate area instead, reveal the exact point to a party on a confirmed booking, and replace the renter maps' blue pins with floating cards carrying each listing's image and name.

**Architecture:** Exact coordinates live in the existing `listings.latitude`/`longitude`, which migration 064 already made private. Two *generated* columns round them to 2 decimals (~1.1 km) and are the only ones the public may read. A `security definer` RPC hands the exact point to the host or to a renter on a confirmed booking. The host picker and both renter maps are Leaflet, following this repo's `ssr: false` dynamic-import rule.

**Tech Stack:** Next.js 16 (App Router), React 19, Leaflet + Esri World Topo tiles (`src/lib/map-tiles.ts`), hosted Supabase Postgres, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-05-exact-pickup-coordinates-design.md`

## Global Constraints

- **This repo has no unit-test framework.** `package.json` scripts are `dev`, `build`, `start`, `lint` only. "Test" here means: a live verification script under `scripts/verify/*.mjs` run with `node --experimental-strip-types`, plus `npx tsc --noEmit`, `npm run lint`, `npm run build`, and a browser pass on a production build. Do not add jest/vitest.
- **Verification scripts use real sessions.** `scripts/verify/env.mjs` exports `admin()` (service role — setup, independent re-reads, cleanup ONLY) and `asUser()`/`signIn()` (anon key + a real session — the only thing that proves an authorisation claim). Throwaway `probe-*@example.com` accounts only; never the demo accounts for destructive steps.
- **Never touch** host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` (Isse Capucao) or booking `RNT-A4DA55`. Re-assert the database baseline at the end of every script.
- **Migration grants:** a table-level privilege satisfies ANY column, so a column grant list only means something after the table-level grant is revoked (migration 040's finding). 064 already revoked `select` on `listings`; **new columns therefore need an explicit `grant select`** or they are invisible to the app.
- **Leaflet touches `window`.** Any `*Leaflet.tsx` is imported via `next/dynamic` with `ssr: false` from a client wrapper, never directly into a Server Component.
- **Tiles come from `src/lib/map-tiles.ts`.** Esri's path is `{z}/{y}/{x}` — row before column. Do not inline a tile URL.
- **Rounding and circle radius are coupled:** 2 dp shifts a point by at most ~775 m, which is why the circle is 1 km. Changing one without the other makes the circle a false claim.
- **Public exposure is opt-in:** only `approx_latitude`, `approx_longitude`, `location_is_exact` may enter `LISTING_COLUMNS`. Exact coordinates never do.

---

### Task 1: Schema for coordinates

**Files:**
- Create: `supabase/migrations/065_listing_coordinates.sql`
- Test: `scripts/verify/065-listing-coordinates.mjs`

**Interfaces:**
- Consumes: `listings.latitude`/`longitude` (existing, nullable, private since 064).
- Produces: `listings.location_is_exact boolean not null default false`; `listings.approx_latitude`, `listings.approx_longitude` (generated, public).

- [ ] **Step 1: Write the migration**

```sql
-- 065: coordinate columns for the exact-pickup-point feature.
--
-- approx_* are GENERATED, not written by anything: the public value cannot
-- drift from the private one, and there is no code path that could publish an
-- exact coordinate by mistake.
--
-- 2 decimal places is deliberate and is the whole privacy mechanism. It shifts
-- a point by at most ~775m. 3dp shifts by ~77m, which would disclose the host's
-- house while calling itself "approximate" -- see the spec, which records that
-- as the design's own first mistake.
alter table public.listings
  add column location_is_exact boolean not null default false,
  add column approx_latitude  numeric(10,7) generated always as (round(latitude, 2)) stored,
  add column approx_longitude numeric(10,7) generated always as (round(longitude, 2)) stored;

comment on column public.listings.location_is_exact is
  'True only when a host placed the pin. False for rows backfilled from the city centre (066) -- no UI may claim precision for these.';

-- 064 revoked table-level SELECT, so new columns are invisible until granted.
grant select (approx_latitude, approx_longitude, location_is_exact)
  on public.listings to anon, authenticated;
```

- [ ] **Step 2: Apply it**

Run: `supabase db push --linked --yes` then `supabase migration list --linked | tail -1`
Expected: `065` present as both local and remote. Ignore pg-delta cert noise after "Applying migration…".

- [ ] **Step 3: Write the verification script**

```js
// scripts/verify/065-listing-coordinates.mjs
import { URL as SUPABASE_URL, ANON, admin } from './env.mjs'
let fails = 0
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) fails++ }
const anonGet = async (sel) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=${encodeURIComponent(sel)}&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
  return { status: r.status, body: await r.text() }
}

const pub = await anonGet('id,approx_latitude,approx_longitude,location_is_exact')
check('anon can read approx_* and location_is_exact', pub.status === 200, `${pub.status}`)

const exact = await anonGet('latitude,longitude')
check('anon still cannot read exact coordinates', exact.status === 401 || exact.status === 403, `${exact.status}`)

// Generated columns track the source value exactly.
const { body: [row] } = await admin('listings?select=id&limit=1')
await admin(`listings?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ latitude: 14.5678901, longitude: 120.9876543 }) })
const { body: [after] } = await admin(`listings?select=latitude,longitude,approx_latitude,approx_longitude&id=eq.${row.id}`)
check('approx_latitude = round(latitude, 2)', Number(after.approx_latitude) === 14.57, `${after.approx_latitude}`)
check('approx_longitude = round(longitude, 2)', Number(after.approx_longitude) === 120.99, `${after.approx_longitude}`)
check('approx differs from exact', Number(after.approx_latitude) !== Number(after.latitude))
await admin(`listings?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ latitude: null, longitude: null }) })

const { body: [restored] } = await admin(`listings?select=latitude,approx_latitude&id=eq.${row.id}`)
check('cleanup restored the row to null', restored.latitude === null && restored.approx_latitude === null)
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
```

- [ ] **Step 4: Run it**

Run: `node --experimental-strip-types scripts/verify/065-listing-coordinates.mjs`
Expected: `ALL PASS` (6 checks).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/065_listing_coordinates.sql scripts/verify/065-listing-coordinates.mjs
git commit -m "Add coordinate columns with a generated public approximation"
```

---

### Task 2: Backfill, then require coordinates

**Files:**
- Create: `scripts/backfill-listing-coordinates.mjs`
- Create: `supabase/migrations/066_listing_coordinates_required.sql`

**Interfaces:**
- Consumes: `getCityCoordinates(city, province)` from `src/lib/ph-locations.ts` — returns `{ lat, lng }`, never throws.
- Produces: every `listings` row has non-null `latitude`/`longitude`; `location_is_exact` false for all backfilled rows.

**Order is load-bearing: run the script, THEN apply the migration.** The reverse fails on 25 rows.

- [ ] **Step 1: Write the backfill script**

```js
// scripts/backfill-listing-coordinates.mjs
// One-time. Materialises the city-centre pin each listing ALREADY shows into
// latitude/longitude. Nothing is invented: this is the same getCityCoordinates()
// value PickupMap renders today. location_is_exact stays false, so no UI
// presents these as a precise pickup point.
import { admin } from './verify/env.mjs'
const { getCityCoordinates } = await import('../src/lib/ph-locations.ts')

const { body: rows } = await admin('listings?select=id,city,province,latitude,longitude')
let written = 0
for (const l of rows) {
  if (l.latitude !== null && l.longitude !== null) continue
  const { lat, lng } = getCityCoordinates(l.city ?? '', l.province ?? '')
  const res = await admin(`listings?id=eq.${l.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ latitude: lat, longitude: lng, location_is_exact: false }),
  })
  if (res.status >= 400) throw new Error(`${l.id}: ${JSON.stringify(res.body)}`)
  written++
}
const { body: left } = await admin('listings?select=id&or=(latitude.is.null,longitude.is.null)')
console.log(`backfilled ${written}; rows still null: ${left.length}`)
if (left.length > 0) { console.error('ABORT: do not apply 066 while rows are null'); process.exit(1) }
```

- [ ] **Step 2: Run it**

Run: `node --experimental-strip-types scripts/backfill-listing-coordinates.mjs`
Expected: `backfilled 25; rows still null: 0`. If any row is still null, STOP — do not continue to Step 3.

- [ ] **Step 3: Write the migration**

```sql
-- 066: coordinates are required. Run scripts/backfill-listing-coordinates.mjs
-- FIRST -- this fails while any row is null.
alter table public.listings
  alter column latitude  set not null,
  alter column longitude set not null;
```

- [ ] **Step 4: Apply and confirm**

Run: `supabase db push --linked --yes && supabase migration list --linked | tail -1`
Expected: `066` local and remote.

- [ ] **Step 5: Verify the backfill matches the map's own lookup**

```js
// append to scripts/verify/065-listing-coordinates.mjs, or run inline
const { getCityCoordinates } = await import('../../src/lib/ph-locations.ts')
const { body: all } = await admin('listings?select=id,city,province,latitude,longitude,location_is_exact')
const mismatched = all.filter(l => {
  const { lat, lng } = getCityCoordinates(l.city ?? '', l.province ?? '')
  return Math.abs(Number(l.latitude) - lat) > 1e-6 || Math.abs(Number(l.longitude) - lng) > 1e-6
})
check('every backfilled row equals its city-centre lookup', mismatched.length === 0, `${mismatched.length} off`)
check('no backfilled row claims to be exact', all.every(l => l.location_is_exact === false))
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-listing-coordinates.mjs supabase/migrations/066_listing_coordinates_required.sql
git commit -m "Backfill listing coordinates from the city centre, then require them"
```

---

### Task 3: RPC that reveals the exact point

**Files:**
- Create: `supabase/migrations/067_get_listing_coordinates.sql`
- Test: `scripts/verify/067-listing-coordinates-rpc.mjs`

**Interfaces:**
- Produces: `get_listing_coordinates(p_listing_id uuid) returns table (latitude numeric, longitude numeric)`. Returns zero rows when the caller is not entitled — never raises, so the UI branches on emptiness.

- [ ] **Step 1: Write the migration**

```sql
-- 067: the only path to a listing's exact coordinates.
--
-- Entitled callers: the listing's host, and a renter with a booking that has
-- reached confirmed. `pending` is excluded deliberately -- an unpaid, unaccepted
-- request must not reveal where the host lives. active/completed are included
-- because a renter mid-rental (or returning gear) still needs the address.
--
-- Returns zero rows rather than raising, so the client renders the approximate
-- view for an unentitled caller instead of showing an error.
create or replace function public.get_listing_coordinates(p_listing_id uuid)
returns table (latitude numeric, longitude numeric)
language sql
security definer
stable
set search_path = public
as $$
  select l.latitude, l.longitude
  from public.listings l
  where l.id = p_listing_id
    and (
      l.host_id = auth.uid()
      or exists (
        select 1
        from public.bookings b
        where b.listing_id = l.id
          and b.renter_id  = auth.uid()
          and b.status in ('confirmed', 'active', 'completed')
      )
    );
$$;

revoke execute on function public.get_listing_coordinates(uuid) from public, anon;
grant execute on function public.get_listing_coordinates(uuid) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db push --linked --yes && supabase migration list --linked | tail -1`
Expected: `067` local and remote.

- [ ] **Step 3: Write the verification script**

Build a throwaway host + renter + listing + booking (copy the setup block from
`scripts/verify/020-mark-payout-failed.mjs`, which already does exactly this and
drives a booking through the host's own session). Then assert:

```js
check('host gets their own exact coordinates', hostRes.body.length === 1 && Number(hostRes.body[0].latitude) === PLACED_LAT)
check('renter with a PENDING booking gets nothing', pendingRes.body.length === 0)
check('renter with a CONFIRMED booking gets the exact point', confirmedRes.body.length === 1)
check('unrelated signed-in user gets nothing', strangerRes.body.length === 0)
check('anon cannot execute the RPC at all', [401, 403, 404].includes(anonRes.status), `${anonRes.status}`)
check('exact coordinates still unreadable from the table', tableRes.status === 401 || tableRes.status === 403)
```

- [ ] **Step 4: Run it**

Run: `node --experimental-strip-types scripts/verify/067-listing-coordinates-rpc.mjs`
Expected: `ALL PASS`, baseline restored, forbidden host untouched.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/067_get_listing_coordinates.sql scripts/verify/067-listing-coordinates-rpc.mjs
git commit -m "Add the confirmed-booking gate for exact listing coordinates"
```

---

### Task 4: The host's map picker

**Files:**
- Create: `src/components/host/LocationPicker.tsx` (client wrapper, `ssr: false`)
- Create: `src/components/host/LocationPickerLeaflet.tsx` (the map itself)

**Interfaces:**
- Produces: `<LocationPicker city={string} province={string} value={{ lat: number; lng: number } | null} onChange={(c: { lat: number; lng: number }) => void} />`

- [ ] **Step 1: Write the Leaflet picker**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@/lib/map-tiles'
import { getCityCoordinates } from '@/lib/ph-locations'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Next's webpack loader returns StaticImageData (.src); Turbopack's dev loader
// returns the URL string. Handle both, exactly as PickupMapLeaflet does.
function assetSrc(mod: string | { src: string }): string {
  return typeof mod === 'string' ? mod : mod.src
}

interface Props {
  city: string
  province: string
  value: { lat: number; lng: number } | null
  onChange: (c: { lat: number; lng: number }) => void
}

export default function LocationPickerLeaflet({ city, province, value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  // onChange changes identity every render; keep it in a ref so the map is
  // built once and the handler always calls the latest one.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const start = value ?? getCityCoordinates(city, province)
      const icon = L.icon({
        iconUrl: assetSrc(markerIconUrl),
        iconRetinaUrl: assetSrc(markerIconRetinaUrl),
        shadowUrl: assetSrc(markerShadowUrl),
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      })

      const map = L.map(containerRef.current, {
        center: [start.lat, start.lng],
        zoom: value ? 16 : 13,
        scrollWheelZoom: false,
      })
      L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map)

      const marker = L.marker([start.lat, start.lng], { icon, draggable: true }).addTo(map)
      const emit = (lat: number, lng: number) => onChangeRef.current({ lat, lng })

      marker.on('dragend', () => {
        const p = marker.getLatLng()
        emit(p.lat, p.lng)
      })
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        marker.setLatLng(e.latlng)
        emit(e.latlng.lat, e.latlng.lng)
      })

      mapRef.current = map
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Built once. Re-centring on a city change is handled by the wrapper's key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="w-full h-64" />
}
```

- [ ] **Step 2: Write the wrapper**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { MapPin, Loader2 } from 'lucide-react'

const Picker = dynamic(() => import('./LocationPickerLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

interface Props {
  city: string
  province: string
  value: { lat: number; lng: number } | null
  onChange: (c: { lat: number; lng: number }) => void
}

export function LocationPicker({ city, province, value, onChange }: Props) {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
      {/* Remount when the city changes so the map re-centres there. */}
      <Picker key={`${province}|${city}`} city={city} province={province} value={value} onChange={onChange} />
      <div className="flex items-start gap-2 px-4 py-3 border-t border-gray-100">
        <MapPin className="w-4 h-4 text-[#003049] shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600">
          {value
            ? 'Pickup point set. Drag the pin or tap the map to adjust.'
            : 'Tap the map to mark exactly where renters collect the gear.'}
          {' '}Renters see an approximate area until a booking is confirmed.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/host/LocationPicker.tsx src/components/host/LocationPickerLeaflet.tsx
git commit -m "Add the host location picker"
```

---

### Task 5: Require a pin in the host wizard

**Files:**
- Modify: `src/components/host/Step5Address.tsx`
- Modify: `src/components/host/ListingWizard.tsx` (the `fields` object, ~line 128-140)

**Interfaces:**
- Consumes: `<LocationPicker />` from Task 4.
- Produces: `AddressData` gains `lat: number | null`, `lng: number | null`. `ListingWizard` writes `latitude`, `longitude`, `location_is_exact: true`.

- [ ] **Step 1: Extend `AddressData` and render the picker**

In `Step5Address.tsx` add `lat: number | null` and `lng: number | null` to the
`AddressData` interface, then render below the city field:

```tsx
<LocationPicker
  city={data.city}
  province={data.province}
  value={data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null}
  onChange={(c) => onChange({ ...data, lat: c.lat, lng: c.lng })}
/>
```

**Use ONE `onChange({ ...data, ... })` call, never two `set()` calls.** Two calls each
spread the same stale `data` prop and the second silently discards the first — that exact
bug has been found and fixed twice in this repo (the province/city selector, then
`Step6Verify`).

- [ ] **Step 2: Gate the Continue button**

```tsx
const canContinue = Boolean(data.province && data.city && data.lat != null && data.lng != null)
```

Disable Continue on `!canContinue` and render, when a pin is missing:

```tsx
<p className="text-sm text-amber-700">Mark your pickup point on the map to continue.</p>
```

- [ ] **Step 3: Persist the coordinates**

In `ListingWizard.tsx`'s `fields` object add:

```ts
latitude: address.lat,
longitude: address.lng,
location_is_exact: true,
```

Do not touch `submittingRef`, `listingIdRef` or `uploadedImagesRef` — that idempotency
machinery is what makes a retry update rather than insert a duplicate.

- [ ] **Step 4: Verify a real submission**

Run `npm run build && npm start -- -p 3100`, sign in as a throwaway host, complete the
wizard, then read the row back with the service role:

```js
const { body: [l] } = await admin(`listings?select=latitude,longitude,location_is_exact&id=eq.${id}`)
check('wizard stored the placed pin', Number(l.latitude) === placedLat && l.location_is_exact === true)
```

Expected: PASS. Also confirm Continue is disabled before a pin is placed.

- [ ] **Step 5: Commit**

```bash
git add src/components/host/Step5Address.tsx src/components/host/ListingWizard.tsx
git commit -m "Require a pickup point in the host wizard"
```

---

### Task 6: Let hosts move the pin from the edit page

**Files:**
- Modify: `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `<LocationPicker />` (Task 4), `get_listing_coordinates` (Task 3).

- [ ] **Step 1: Load the existing point through the RPC**

The page's select uses `LISTING_COLUMNS`, which cannot include exact coordinates. Fetch
them separately:

```ts
const { data: coords } = await supabase.rpc('get_listing_coordinates', { p_listing_id: id })
const point = coords?.[0] ? { lat: Number(coords[0].latitude), lng: Number(coords[0].longitude) } : null
```

- [ ] **Step 2: Render the picker and save**

Render `<LocationPicker />` seeded with `point`, and include in the update payload:

```ts
latitude: point.lat,
longitude: point.lng,
location_is_exact: true,
```

- [ ] **Step 3: Verify**

Load the edit page as the owning host on a production build, drag the pin, save, then:

```js
const { body: [l] } = await admin(`listings?select=latitude,longitude,location_is_exact&id=eq.${listingId}`)
check('edit page saved the moved pin', Math.abs(Number(l.latitude) - movedLat) < 1e-6, `${l.latitude}`)
check('and marked it exact', l.location_is_exact === true)
```

Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(main)/dashboard/listings/[id]/edit/page.tsx"
git commit -m "Let hosts move the pickup pin from the edit page"
```

---

### Task 7: Floating card on the listing page map

**Files:**
- Modify: `src/lib/listing-columns.ts` (add the three public columns)
- Modify: `src/components/listings/PickupMap.tsx`
- Modify: `src/components/listings/PickupMapLeaflet.tsx`
- Modify: `src/app/(main)/listings/[id]/page.tsx` (pass title + image)

**Interfaces:**
- Produces: `<PickupMap city province title imageUrl approxLat approxLng />`. No
  `locationIsExact` prop: the public map is approximate for every listing, so the flag
  changes nothing here. It exists for admin/host-side copy only.

- [ ] **Step 1: Publish the approximate columns**

In `LISTING_COLUMNS`, append `, approx_latitude, approx_longitude, location_is_exact`.
Do not add `latitude`/`longitude`.

- [ ] **Step 2: Replace the pin with a card and add the circle**

In `PickupMapLeaflet.tsx`, centre on `approxLat`/`approxLng` when present (falling back to
`getCityCoordinates` when not), and swap `L.marker(...)` for a `divIcon`:

```ts
const card = L.divIcon({
  className: '',
  html: `<div style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:12px;
      box-shadow:0 4px 14px rgba(0,0,0,.18);padding:6px 10px 6px 6px;white-space:nowrap">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover"
        onerror="this.style.display='none'" />` : ''}
      <span style="font-weight:600;font-size:12px;color:#111827;max-width:180px;overflow:hidden;
        text-overflow:ellipsis">${escapeHtml(title)}</span>
    </div>`,
  iconSize: [0, 0],
  iconAnchor: [0, 0],
})
L.marker([lat, lng], { icon: card }).addTo(map)
L.circle([lat, lng], { radius: 1000, color: '#003049', weight: 1, fillOpacity: 0.08 }).addTo(map)
```

`escapeHtml` already exists in `SearchMapLeaflet.tsx`; move it to a shared module rather
than copying it — listing titles are host-authored and go straight into `innerHTML`.

- [ ] **Step 3: Update the copy**

`PickupMap.tsx`'s caption becomes:

```tsx
<span className="font-semibold text-[#111827]">{city}, {province}</span>
{' — approximate area. '}The exact pickup point is shared once your booking is confirmed.
```

- [ ] **Step 4: Verify on a production build**

`npm run build && npm start -- -p 3100`, open a listing page, and assert in the browser:
card rendered with image and title, `.leaflet-container` present, circle path present,
tiles loading, zero console errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing-columns.ts src/components/listings/PickupMap.tsx src/components/listings/PickupMapLeaflet.tsx "src/app/(main)/listings/[id]/page.tsx"
git commit -m "Show a floating listing card on the pickup map"
```

---

### Task 8: One card per listing on the search map

**Files:**
- Modify: `src/components/search/SearchMapLeaflet.tsx`

- [ ] **Step 1: Replace city grouping with per-listing cards**

Drop the `groups` map. For each listing, place a card `divIcon` (same markup as Task 7,
plus `₱{daily_price}/day`) at its `approx_latitude`/`approx_longitude`, falling back to
`getCityCoordinates(city, province)` when either is null. Wrap each card in
`<a href="/listings/{id}">`. Fit bounds to all points.

**No collision handling** — the owner chose one card per listing knowing they overlap where
listings cluster. Add only:

```ts
marker.on('mouseover', () => marker.setZIndexOffset(1000))
marker.on('mouseout',  () => marker.setZIndexOffset(0))
```

so an overlapped card is still clickable. That is legibility, not de-collision — do not add
clustering.

- [ ] **Step 2: Verify**

On a production build, switch the search page to Map view and assert: one card per visible
listing (23 today), zero broken images, tiles loading, clicking a card navigates to that
listing, zero console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/search/SearchMapLeaflet.tsx
git commit -m "Plot one floating listing card per result on the search map"
```

---

### Task 9: Clear coordinates on account deletion

**Files:**
- Modify: `src/lib/account-deletion.ts` (~line 227, the listings update)

**This discharges the standing obligation in AGENTS.md:** any new PII column on a table
must be added to this module's purge/anonymise list. Exact coordinates are the host's home.

- [ ] **Step 1: Extend the listings scrub**

`latitude`/`longitude` are `NOT NULL` as of 066, so they cannot be nulled. Reset them to
the city centre and drop the exactness claim:

```ts
// Coordinates are NOT NULL (066), so reset to the city centre rather than
// nulling — the same value a listing had before its host placed a pin.
const { data: owned } = await admin.from('listings').select('id, city, province').eq('host_id', uid)
for (const l of owned ?? []) {
  const { lat, lng } = getCityCoordinates(l.city ?? '', l.province ?? '')
  await admin.from('listings')
    .update({ latitude: lat, longitude: lng, location_is_exact: false })
    .eq('id', l.id)
}
```

Keep this in the same block as the existing `is_active: false, street_address: null` update
so a reader sees one place where a host's location is scrubbed.

- [ ] **Step 2: Verify**

Extend the existing deletion verification: create a throwaway host with a placed pin, run
the deletion, and assert the stored coordinates equal the city centre and
`location_is_exact` is false.

- [ ] **Step 3: Commit**

```bash
git add src/lib/account-deletion.ts
git commit -m "Reset pickup coordinates when a host deletes their account"
```

---

### Task 10: Whole-feature verification and documentation

**Files:**
- Create: `scripts/verify/exact-coordinates-e2e.mjs`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the end-to-end script**

One run, throwaway accounts only, asserting exactly this:

```js
check('host-placed pin stored verbatim', Number(row.latitude) === PLACED.lat && Number(row.longitude) === PLACED.lng)
check('placing a pin marks the listing exact', row.location_is_exact === true)
check('anon reads approx_*', pub.status === 200 && pub.body[0].approx_latitude != null)
const shift = haversineMetres(PLACED, { lat: Number(pub.body[0].approx_latitude), lng: Number(pub.body[0].approx_longitude) })
check('published point is coarsened, not exact', shift > 0, `${shift.toFixed(0)}m`)
check('published point stays within the 1km circle', shift <= 1000, `${shift.toFixed(0)}m`)
check('anon refused the exact columns', anonExact.status === 401 || anonExact.status === 403)
check('anon refused the RPC', [401, 403, 404].includes(anonRpc.status))
check('signed-in stranger refused the RPC', stranger.body.length === 0)
check('renter with a PENDING booking gets nothing', pending.body.length === 0)
check('CONTROL: same renter after confirmation gets the exact point',
  confirmed.body.length === 1 && Number(confirmed.body[0].latitude) === PLACED.lat)
check('account deletion resets to the city centre and clears the exact flag',
  Math.abs(Number(afterDelete.latitude) - cityCentre.lat) < 1e-6 && afterDelete.location_is_exact === false)
```

The pending-then-confirmed pair is the load-bearing one: without the CONTROL line a refusal
could come from any unrelated guard rather than the booking status.

- [ ] **Step 2: Run everything**

```bash
node --experimental-strip-types scripts/verify/exact-coordinates-e2e.mjs
node --experimental-strip-types scripts/verify/065-listing-coordinates.mjs
node --experimental-strip-types scripts/verify/067-listing-coordinates-rpc.mjs
node --experimental-strip-types scripts/verify/059-profiles-column-select.mjs
npx tsc --noEmit && npm run lint && npm run build
```

Expected: all `ALL PASS`, build clean. 059 is re-run because this feature touches the same
column-grant machinery.

Task 7 widened `LISTING_COLUMNS`, which is exactly what can blank the storefront if a new
column is not granted, so assert it explicitly:

```js
const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=${encodeURIComponent(LISTING_COLUMNS + ', host:profiles!listings_host_id_fkey!inner(' + PROFILE_COLUMNS + ')')}&is_active=eq.true&is_draft=eq.false`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
check('storefront !inner join still returns rows', res.status === 200 && (await res.json()).length === 23)
```

An `!inner` embed the caller cannot read returns ZERO parent rows, so a missing grant shows
up as an empty storefront rather than an error.

- [ ] **Step 3: Update AGENTS.md**

Add a Status entry recording: the privacy decision and who made it, why 2 dp rather than
3 dp, that `approx_*` are generated so the public value cannot drift, the RPC's entitled
callers, that the search map now plots per listing without collision handling **by explicit
choice**, and — in the pickup-map architecture note — that the "unused latitude/longitude"
rule is now superseded.

- [ ] **Step 4: Commit and deploy**

```bash
git add scripts/verify/exact-coordinates-e2e.mjs AGENTS.md
git commit -m "Verify the exact-coordinates feature end to end"
git push origin main   # auto-deploys; the manual vercel CLI step is redundant
```
