# Host & Renter QA Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six issues found in a production QA pass — a missing Digital Camera category, province/map coverage, duplicate listings on wizard retry, no admin verification gate before publish, no delivery fee in checkout, and GCash/Maya dead-ending on a PayMongo account block.

**Architecture:** Three DB migrations (`036` enum, `037` publish gate, `038` delivery fee) plus targeted application changes. Money stays server-computed in `create_booking`; the publish gate is enforced by database triggers rather than client checks, because `authenticated` holds `insert/update` on `listings` and a client-side gate would be trivially bypassable.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, Tailwind 4, hosted Supabase (Postgres + Auth + Storage), PayMongo.

**Spec:** `docs/superpowers/specs/2026-09-02-host-qa-fixes-design.md`

## Global Constraints

- **This project has no unit test suite, and this plan does not introduce one.** The established verification method (AGENTS.md, "E2E test pattern") is a Node script that signs a demo account in via the auth REST API, drives the real hosted database, asserts, and cleans up with `SUPABASE_SECRET_KEY`. Every task below follows the same TDD cycle in that idiom: **write the verification script first, run it, watch it fail for the right reason, implement, re-run until it passes.** A script that passes before the implementation exists is a broken script — fix it before continuing.
- Verification scripts are throwaway. Write them under the scratchpad directory, never into the repo.
- Demo accounts: host `demo@demo.rentivo.ph`, renter `renter@demo.rentivo.ph`, both password `DemoRentivo1`.
- Apply migrations with `supabase db push --linked --yes`, then confirm with `supabase migration list --linked`. Ignore pg-delta cert noise printed after "Applying migration…".
- **Never use `select('*')` on `listings` or on a joined `profiles`.** Use `LISTING_COLUMNS` / `PROFILE_COLUMNS` from `src/lib/listing-columns.ts`. A new column is invisible to every read path until it is added to that allowlist.
- Money is computed server-side in `create_booking` only. Never trust a client-supplied amount.
- Primary color `#003049`; accent `#FDF0D5` is a **background** color — never use it as text or icon color on a light background.
- `npm run build` and `npm run lint` must be clean at the end of every task.
- Currency format: `₱X,XXX`. Peso amounts are integers.
- Commit once per task, imperative summary, one commit per wired feature slice.

---

## File Structure

**Created:**
- `supabase/migrations/036_add_digital_camera_category.sql` — enum value only
- `supabase/migrations/037_gate_listings_on_verification.sql` — publish gate triggers + auto-publish + retroactive sweep
- `supabase/migrations/038_delivery_fee.sql` — delivery fee columns, `create_booking`, `request_payout`

**Modified:**
- `src/lib/ph-locations.ts` — becomes the single source of truth for PH provinces and city coordinates
- `src/lib/pricing.ts` — delivery fee in the shared client-side mirror of `create_booking`'s math
- `src/lib/listing-columns.ts` — `delivery_fee` added to `LISTING_COLUMNS`
- `src/types/index.ts` — `'digital'` category, `Listing.delivery_fee`, `Booking.delivery_fee`
- `src/components/host/ListingWizard.tsx` — idempotent submit
- `src/components/host/Step2Details.tsx`, `Step3Pricing.tsx`, `Step5Address.tsx` — category, delivery fee, province list
- `src/components/search/FilterSidebar.tsx` — category filter
- `src/components/booking/Step2Pickup.tsx`, `OrderSummary.tsx`, `Step3Payment.tsx`, `Step4Confirmation.tsx`, `BookingWizard.tsx` — delivery fee, method availability
- `src/app/(main)/dashboard/listings/page.tsx` — pending-review badge
- `src/app/(main)/dashboard/listings/[id]/edit/page.tsx` — category, delivery fee
- `AGENTS.md` — amend the equipment-category scope boundary

---

## Task 1: Digital Camera category

**Files:**
- Create: `supabase/migrations/036_add_digital_camera_category.sql`
- Modify: `src/types/index.ts:1-8`, `src/components/host/Step2Details.tsx:5-12`, `src/components/search/FilterSidebar.tsx:7-14`, `src/app/(main)/dashboard/listings/[id]/edit/page.tsx:12-19`, `AGENTS.md`
- Verify: scratchpad script `verify-036.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `equipment_category` enum accepts `'digital'`; `EquipmentCategory` TS union includes `'digital'`.

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-036.mjs`:

```js
import fs from 'node:fs'
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const URL = g('NEXT_PUBLIC_SUPABASE_URL'), KEY = g('SUPABASE_SECRET_KEY')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

// A listing insert with category 'digital' must succeed once the enum has the value.
const HOST = 'a0000000-0000-4000-8000-0000000000ff' // Demo User (seed host)
const res = await fetch(`${URL}/rest/v1/listings`, {
  method: 'POST',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({
    host_id: HOST, category: 'digital', brand: 'Canon', model: 'G7X Mark III',
    title: 'ENUM PROBE — delete me', description: 'probe', condition: 'good',
    daily_price: 500, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
  }),
})
const body = await res.json()
if (!res.ok) { console.error('FAIL: insert rejected —', JSON.stringify(body)); process.exit(1) }
await fetch(`${URL}/rest/v1/listings?id=eq.${body[0].id}`, { method: 'DELETE', headers: H })
console.log("PASS: equipment_category accepts 'digital'")
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node <scratchpad>/verify-036.mjs`
Expected: `FAIL: insert rejected` with a Postgres message about an invalid input value for enum `equipment_category`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/036_add_digital_camera_category.sql`:

```sql
-- 036_add_digital_camera_category.sql
-- Compact / point-and-shoot cameras had no category that fit — a host
-- listing a Canon G7X Mark III had to shoehorn it into another one.
-- Isolated in its own migration: Postgres does not permit *using* a newly
-- added enum value in the same transaction that adds it (same reason 027
-- isolated 'host_qr').
alter type equipment_category add value if not exists 'digital';
```

- [ ] **Step 4: Apply and re-run**

```bash
supabase db push --linked --yes
supabase migration list --linked   # confirm 036 shows as applied
node <scratchpad>/verify-036.mjs
```
Expected: `PASS: equipment_category accepts 'digital'`

- [ ] **Step 5: Add `'digital'` to the TypeScript union**

In `src/types/index.ts`, change the `EquipmentCategory` union to:

```ts
export type EquipmentCategory =
  | 'mirrorless'
  | 'dslr'
  | 'digital'
  | 'cinema'
  | 'smartphone'
  | 'lens'
  | 'bundle'
```

- [ ] **Step 6: Add the host wizard tile**

In `src/components/host/Step2Details.tsx`, insert into `CATEGORIES` after the `dslr` entry:

```ts
  { value: 'digital', label: 'Digital Camera' },
```

- [ ] **Step 7: Add the search filter option**

In `src/components/search/FilterSidebar.tsx`, insert into `CATEGORIES` after the `dslr` entry:

```ts
  { value: 'digital', label: 'Digital Cameras' },
```

- [ ] **Step 8: Add the edit-page option**

In `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`, insert into `CATEGORIES` after the `dslr` entry:

```ts
  { value: 'digital', label: 'Digital Camera' },
```

- [ ] **Step 9: Amend the documented scope boundary**

In `AGENTS.md`, under "Equipment Categories (scope boundary — do not add others)", change the numbered list to:

```
1. Mirrorless Cameras · 2. DSLR Cameras · 3. Digital Cameras · 4. Cinema Cameras · 5. Smartphones · 6. Camera Lenses · 7. Creator Bundles
```

Do **not** touch `CategoryCards.tsx` or `HeroSearch.tsx` — digital cameras deliberately fold under the existing "Cameras" browse path.

- [ ] **Step 10: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Add Digital Camera equipment category"
```

---

## Task 2: Single source of truth for PH locations

**Files:**
- Modify: `src/lib/ph-locations.ts` (full rewrite), `src/components/host/Step5Address.tsx:19-22` and its province `<select>`
- Verify: scratchpad scripts `gen-locations.mjs` (throwaway generator) and `verify-locations.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const PH_PROVINCES: string[]` — sorted display names, 83 entries (82 provinces + "Metro Manila", which is a region, not a province, but is what hosts pick).
  - `export function getCityCoordinates(city: string, province: string): { lat: number; lng: number }` — unchanged signature, so `PickupMap` and `SearchMap` need no edits.

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-locations.mjs`. It imports the module directly — no DB needed:

```js
import { getCityCoordinates, PH_PROVINCES } from '../../src/lib/ph-locations.ts'

let failed = 0
const check = (name, cond) => { if (!cond) { console.error('FAIL:', name); failed++ } else console.log('ok:', name) }
const near = (a, b, tol = 0.5) => Math.abs(a - b) < tol

check('83 provinces listed', PH_PROVINCES.length === 83)
check('Camarines Sur present', PH_PROVINCES.includes('Camarines Sur'))
check('Metro Manila present', PH_PROVINCES.includes('Metro Manila'))
check('no "Other" entry', !PH_PROVINCES.includes('Other'))
check('sorted', [...PH_PROVINCES].sort((a, b) => a.localeCompare(b)).join() === PH_PROVINCES.join())

// The production bug: this exact row pinned in Manila.
const naga = getCityCoordinates('NAGA CITY CAMARINES SUR', 'Camarines Sur')
check('Naga resolves to Naga, not Manila', near(naga.lat, 13.62) && near(naga.lng, 123.19))

// Legacy rows still resolve rather than throwing.
const legacy = getCityCoordinates('NAGA CITY CAMARINES SUR', 'Other')
check('legacy province "Other" still returns a pin', typeof legacy.lat === 'number')

// Regressions on what already worked.
const makati = getCityCoordinates('Makati', 'Metro Manila')
check('Makati unchanged', near(makati.lat, 14.55, 0.1) && near(makati.lng, 121.02, 0.1))
const cebu = getCityCoordinates('Cebu City', 'Cebu')
check('Cebu City unchanged', near(cebu.lat, 10.31, 0.1))

// Normalization
check('case/suffix insensitive', near(getCityCoordinates('DAVAO', 'Davao del Sur').lat, 7.19, 0.3))
// Province fallback for an unknown municipality
check('unknown city falls back to province center', near(getCityCoordinates('Barangay Nowhere', 'Bohol').lat, 9.8, 0.6))

process.exit(failed ? 1 : 0)
```

Run it with `npx tsx <scratchpad>/verify-locations.mjs` (adjust the relative import path to the repo root).

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx <scratchpad>/verify-locations.mjs`
Expected: fails on `83 provinces listed` (`PH_PROVINCES` is not exported yet) and on the Naga assertion (currently returns Manila's `14.5995 / 120.9842`).

- [ ] **Step 3: Generate the coordinate data**

Write a throwaway generator at `<scratchpad>/gen-locations.mjs` that resolves each name against the OpenStreetMap Nominatim API **once, at authoring time**, and prints the finished TypeScript tables to stdout. Nominatim requires a descriptive User-Agent and a max of 1 request/second — respect both or you will be blocked.

```js
const PROVINCES = [
  'Abra','Agusan del Norte','Agusan del Sur','Aklan','Albay','Antique','Apayao','Aurora',
  'Basilan','Bataan','Batanes','Batangas','Benguet','Biliran','Bohol','Bukidnon','Bulacan',
  'Cagayan','Camarines Norte','Camarines Sur','Camiguin','Capiz','Catanduanes','Cavite','Cebu',
  'Cotabato','Davao de Oro','Davao del Norte','Davao del Sur','Davao Occidental','Davao Oriental',
  'Dinagat Islands','Eastern Samar','Guimaras','Ifugao','Ilocos Norte','Ilocos Sur','Iloilo',
  'Isabela','Kalinga','La Union','Laguna','Lanao del Norte','Lanao del Sur','Leyte',
  'Maguindanao del Norte','Maguindanao del Sur','Marinduque','Masbate','Metro Manila',
  'Misamis Occidental','Misamis Oriental','Mountain Province','Negros Occidental','Negros Oriental',
  'Northern Samar','Nueva Ecija','Nueva Vizcaya','Occidental Mindoro','Oriental Mindoro','Palawan',
  'Pampanga','Pangasinan','Quezon','Quirino','Rizal','Romblon','Samar','Sarangani','Siquijor',
  'Sorsogon','South Cotabato','Southern Leyte','Sultan Kudarat','Sulu','Surigao del Norte',
  'Surigao del Sur','Tarlac','Tawi-Tawi','Zambales','Zamboanga del Norte','Zamboanga del Sur',
  'Zamboanga Sibugay',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { 'User-Agent': 'rentivo-location-table-generator/1.0' } })
  const j = await r.json()
  await sleep(1100)
  if (!j[0]) { console.error('// UNRESOLVED:', q); return null }
  return { lat: +(+j[0].lat).toFixed(4), lng: +(+j[0].lon).toFixed(4) }
}

for (const p of PROVINCES) {
  const c = await geocode(`${p}, Philippines`)
  if (c) console.log(`  '${p.toLowerCase()}': { lat: ${c.lat}, lng: ${c.lng} },`)
}
```

Run the same generator over the city list (the ~145 chartered cities of the Philippines), emitting `'<city lowercase>': { lat, lng },` lines keyed **without** the trailing "City" so they match the normalizer in Step 4.

**Sanity-check every generated coordinate before pasting it in:** every Philippine coordinate must satisfy `lat` between `4.5` and `21.5` and `lng` between `116.0` and `127.0`. Print and fix any row outside that box — Nominatim occasionally returns a same-named place in another country. Any name the generator reports as `UNRESOLVED` must be resolved by hand, not dropped.

- [ ] **Step 4: Rewrite `src/lib/ph-locations.ts`**

Keep the existing file header comment (it explains the deliberate city-level coarseness). The file's new shape:

```ts
/** Display list for the host wizard's province dropdown. Single source of
 *  truth — Step5Address imports this rather than keeping its own copy, which
 *  is what let the two drift until every unlisted city pinned in Manila. */
export const PH_PROVINCES: string[] = [
  /* the 83 names, alphabetically sorted, from the generator */
]

const PROVINCE_COORDS: Record<string, { lat: number; lng: number }> = {
  /* generated: all 83, keys lowercased */
}

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  /* generated: ~145 chartered cities, keys lowercased and "city"-stripped */
}

/** Cities grouped by province, for the province-scoped fallback below. */
const CITIES_BY_PROVINCE: Record<string, string[]> = {
  /* generated: province key -> its city keys */
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bcity\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolution order: exact city → a known city of the selected province
 * appearing in the free-text input → province center → Manila.
 * Always returns a pin; never throws.
 */
export function getCityCoordinates(city: string, province: string) {
  const cityKey = normalize(city)
  const provinceKey = normalize(province)

  if (CITY_COORDS[cityKey]) return CITY_COORDS[cityKey]

  // Hosts type free text like "NAGA CITY CAMARINES SUR" — look for any city
  // of the selected province inside it. Longest match first, so "san jose
  // del monte" beats "san jose".
  const candidates = (CITIES_BY_PROVINCE[provinceKey] ?? [])
    .slice()
    .sort((a, b) => b.length - a.length)
  for (const candidate of candidates) {
    if (cityKey.includes(candidate)) return CITY_COORDS[candidate]
  }

  return PROVINCE_COORDS[provinceKey] ?? PROVINCE_COORDS['metro manila']
}
```

Note `normalize()` strips `"city"` as a **whole word only** (`\bcity\b`), so "Cotabato City" normalizes to "cotabato" but a name that merely contains the letters is untouched.

- [ ] **Step 5: Re-run the verification script**

Run: `npx tsx <scratchpad>/verify-locations.mjs`
Expected: every check prints `ok:` and the script exits 0. Fix the table and re-run until it does.

- [ ] **Step 6: Point the wizard at the shared list**

In `src/components/host/Step5Address.tsx`:

Delete the local `PROVINCES` array (lines 19-22) and import the shared one:

```ts
import { PH_PROVINCES } from '@/lib/ph-locations'
```

Then change the `<select>`'s map from `{PROVINCES.map(...)}` to:

```tsx
          {PH_PROVINCES.map(p => <option key={p}>{p}</option>)}
```

Leave the `onChange` exactly as it is — `onChange({ ...data, province: e.target.value, city: '' })` is the single-call form that fixed the earlier "province silently discards its own selection" bug. Splitting it back into two `set()` calls would reintroduce that bug.

- [ ] **Step 7: Verify in the browser**

```bash
npm run dev
```

Open `/host/new`, go to step 5, and confirm: the dropdown lists all 83 entries alphabetically, "Camarines Sur" is present, "Other" is gone, and selecting a province persists (does not reset to blank).

- [ ] **Step 8: Verify the map end-to-end**

Point a listing at Naga and confirm the pin moved. Using the existing Naga listing:

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
fetch(url+'/rest/v1/listings?id=eq.654bfee2-586d-4e18-9138-fcc48cc3fe07',{
  method:'PATCH',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({province:'Camarines Sur',city:'Naga City'})}).then(r=>console.log(r.status));
"
```

Then load `/listings/654bfee2-586d-4e18-9138-fcc48cc3fe07` and confirm the pickup map centers on Naga, not Manila. Check `/search` in map view for the same listing.

- [ ] **Step 9: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Make ph-locations the single source of truth for provinces and city pins"
```

---

## Task 3: Idempotent listing wizard

**Files:**
- Modify: `src/components/host/ListingWizard.tsx:33-140`
- Verify: manual failure injection + scratchpad script `verify-no-duplicates.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: no exported API change. `ListingWizard` still exports the same component.

**Background:** `handleSubmit()` runs five sequential writes — photo uploads, `listings` insert, `availability_blocks` insert, `profiles.is_host` update, verification upload + insert. The listing insert is #2. Any failure in #3–#5 shows an error banner and leaves the host on step 6; the retry re-runs **all five from the top**, producing a second listing. Confirmed in production: two `Canon G7X Mark III` rows 17 seconds apart with different image URLs.

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-no-duplicates.mjs`, which counts a host's listings by title so you can assert "exactly one" after a forced-failure retry:

```js
import fs from 'node:fs'
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const URL = g('NEXT_PUBLIC_SUPABASE_URL'), KEY = g('SUPABASE_SECRET_KEY')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const title = process.argv[2]
if (!title) { console.error('usage: node verify-no-duplicates.mjs "<listing title>"'); process.exit(2) }
const r = await fetch(`${URL}/rest/v1/listings?select=id,title,created_at,images&title=eq.${encodeURIComponent(title)}`, { headers: H })
const rows = await r.json()
console.log(`${rows.length} row(s) titled ${JSON.stringify(title)}`)
rows.forEach((x) => console.log(' ', x.id, x.created_at, `${x.images.length} image(s)`))
if (rows.length !== 1) { console.error(`FAIL: expected exactly 1, got ${rows.length}`); process.exit(1) }
console.log('PASS: exactly one listing row')
```

- [ ] **Step 2: Reproduce the bug and watch the script fail**

In `ListingWizard.tsx`, temporarily force step 4 to fail by inserting this line immediately after the `availability_blocks` block and before the `profiles` update:

```ts
      throw new Error('FORCED FAILURE — remove me')
```

Run `npm run dev`, sign in as the demo host, complete the wizard with a unique title (e.g. brand `ProbeBrand`, model `Dup Test`), click Submit, see the error, then click Submit again.

Run: `node <scratchpad>/verify-no-duplicates.mjs "ProbeBrand Dup Test"`
Expected: `FAIL: expected exactly 1, got 2` — the bug, reproduced.

Clean up the two probe rows before continuing:

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
fetch(url+'/rest/v1/listings?title=eq.ProbeBrand%20Dup%20Test',{method:'DELETE',headers:{apikey:key,Authorization:'Bearer '+key}}).then(r=>console.log('deleted',r.status));
"
```

- [ ] **Step 3: Add the resume refs**

In `src/components/host/ListingWizard.tsx`, change the React import to include `useRef`:

```ts
import { useRef, useState } from 'react'
```

Then, inside the component next to the existing `useState` declarations, add:

```ts
  // Submit is resumable: a failure after the listing row exists must never
  // re-upload photos or insert a second listing. Refs (not state) so a retry
  // in the same mount always sees the latest values.
  const submittingRef = useRef(false)
  const listingIdRef = useRef<string | null>(null)
  const uploadedImagesRef = useRef<Map<File, string>>(new Map())
  const [warning, setWarning] = useState('')
```

- [ ] **Step 4: Guard against double submit**

Replace the opening of `handleSubmit`:

```ts
  async function handleSubmit() {
    setError('')
    setLoading(true)
```

with:

```ts
  async function handleSubmit() {
    // setLoading is async, so two rapid clicks can both pass `disabled={loading}`
    // before React re-renders. The ref closes that window synchronously.
    if (submittingRef.current) return
    submittingRef.current = true
    setError('')
    setWarning('')
    setLoading(true)
```

and change the `finally` block from:

```ts
    } finally {
      setLoading(false)
    }
```

to:

```ts
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
```

- [ ] **Step 5: Make photo uploads resumable**

Replace the photo-upload loop:

```ts
      const imageUrls: string[] = []
      for (const { file } of state.photos) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('listing-images')
          .upload(path, file, { contentType: file.type })
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`)
        imageUrls.push(supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl)
      }
```

with:

```ts
      const imageUrls: string[] = []
      for (const { file } of state.photos) {
        // Already uploaded on an earlier attempt — reuse it rather than
        // orphaning a second copy in the bucket.
        const existing = uploadedImagesRef.current.get(file)
        if (existing) { imageUrls.push(existing); continue }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('listing-images')
          .upload(path, file, { contentType: file.type })
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`)
        const url = supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl
        uploadedImagesRef.current.set(file, url)
        imageUrls.push(url)
      }
```

- [ ] **Step 6: Make the listing write insert-once, update-after**

Replace the existing `const { details, pricing, address } = state` line **together with** the `const { data: listing, error: insertError } = await supabase.from('listings').insert({...}).select('id').single()` call and its error check. All three go, replaced by:

(Replacing the destructure line too matters — the snippet below re-declares it, and leaving the original in place is a duplicate-identifier build error.)

```ts
      const { details, pricing, address } = state
      const fields = {
        host_id: user.id,
        category: details.category,
        brand: details.brand,
        model: details.model,
        title: `${details.brand} ${details.model}`.trim(),
        description: details.description,
        condition: details.condition,
        serial_number: details.serialNumber || null,
        daily_price: Number(pricing.dailyPrice),
        weekly_price: pricing.weeklyPrice ? Number(pricing.weeklyPrice) : null,
        monthly_price: pricing.monthlyPrice ? Number(pricing.monthlyPrice) : null,
        security_deposit: Number(pricing.securityDeposit || 0),
        city: address.city,
        province: address.province,
        street_address: address.streetAddress || null,
        is_instant_book: address.isInstantBook,
        images: imageUrls,
        accessories: details.accessories,
      }

      // The pivot: once a listing row exists for this submit, every retry
      // updates it. This is what makes a duplicate structurally impossible.
      if (listingIdRef.current) {
        const { error: updateError } = await supabase
          .from('listings')
          .update(fields)
          .eq('id', listingIdRef.current)
        if (updateError) throw new Error(`Could not update listing: ${updateError.message}`)
      } else {
        const { data: created, error: insertError } = await supabase
          .from('listings')
          .insert(fields)
          .select('id')
          .single()
        if (insertError) throw new Error(`Could not create listing: ${insertError.message}`)
        listingIdRef.current = created.id
      }
      const newListingId = listingIdRef.current as string
```

Then replace the two later uses of `listing.id` — `listing_id: listing.id` in the availability-blocks insert, and `setListingId(listing.id)` — with `newListingId`.

- [ ] **Step 7: Make the post-insert steps non-fatal**

The listing now exists; the host's work is saved. Replace the availability-blocks, `is_host`, and verification sections with versions that collect warnings instead of throwing. Replace this block:

```ts
      if (state.blockedDates.length > 0) {
        const { error: blockError } = await supabase.from('availability_blocks').insert(
          state.blockedDates.map(d => ({ listing_id: newListingId, blocked_on: d, reason: 'personal' }))
        )
        if (blockError) throw new Error(`Could not save blocked dates: ${blockError.message}`)
      }

      await supabase.from('profiles').update({ is_host: true }).eq('id', user.id)
```

with:

```ts
      // From here the listing row exists. A failure below must NOT send the
      // host back to a retry — that is exactly what produced duplicate
      // listings in production. Collect warnings and finish successfully.
      const warnings: string[] = []

      if (state.blockedDates.length > 0) {
        const { error: blockError } = await supabase.from('availability_blocks').insert(
          state.blockedDates.map(d => ({ listing_id: newListingId, blocked_on: d, reason: 'personal' }))
        )
        if (blockError) warnings.push('Your blocked dates could not be saved — set them again from the Calendar page.')
      }

      const { error: hostFlagError } = await supabase.from('profiles').update({ is_host: true }).eq('id', user.id)
      if (hostFlagError) warnings.push('Your host profile flag could not be updated. Contact support if your dashboard looks wrong.')
```

Then wrap the verification section's three `throw` statements. Replace the verification block with:

```ts
      // Identity verification — only if the host actually picked new files
      // (already-verified hosts, or ones with a submission already pending, skip this)
      if (state.verify.idFile && state.verify.selfieFile) {
        try {
          const idExt = state.verify.idFile.name.split('.').pop()?.toLowerCase() || 'jpg'
          const selfieExt = state.verify.selfieFile.name.split('.').pop()?.toLowerCase() || 'jpg'
          const idPath = `${user.id}/id-${Date.now()}.${idExt}`
          const selfiePath = `${user.id}/selfie-${Date.now()}.${selfieExt}`

          const { error: idUploadError } = await supabase.storage
            .from('verification-docs')
            .upload(idPath, state.verify.idFile, { contentType: state.verify.idFile.type })
          if (idUploadError) throw new Error(idUploadError.message)

          const { error: selfieUploadError } = await supabase.storage
            .from('verification-docs')
            .upload(selfiePath, state.verify.selfieFile, { contentType: state.verify.selfieFile.type })
          if (selfieUploadError) throw new Error(selfieUploadError.message)

          const { error: verifyInsertError } = await supabase.from('verification_requests').insert({
            user_id: user.id,
            id_doc_path: idPath,
            selfie_path: selfiePath,
          })
          if (verifyInsertError) throw new Error(verifyInsertError.message)
        } catch (verifyErr) {
          const detail = verifyErr instanceof Error ? verifyErr.message : 'unknown error'
          warnings.push(`Your listing was created, but the ID verification upload failed (${detail}). Retry it from Settings — your listing stays hidden until your ID is approved.`)
        }
      }

      setWarning(warnings.join(' '))
      setListingId(newListingId)
      setDone(true)
```

Delete the now-duplicated `setListingId(...)` / `setDone(true)` lines that previously followed this block.

- [ ] **Step 8: Validate files before uploading**

Immediately after the `if (!user) throw ...` line, add:

```ts
      // Catch bad files before any write, so a bucket rejection can't strand
      // the submit halfway through.
      const MAX_BYTES = 10 * 1024 * 1024
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
      const toCheck: { file: File; what: string }[] = [
        ...state.photos.map(p => ({ file: p.file, what: 'photo' })),
        ...(state.verify.idFile ? [{ file: state.verify.idFile, what: 'ID document' }] : []),
        ...(state.verify.selfieFile ? [{ file: state.verify.selfieFile, what: 'selfie' }] : []),
      ]
      for (const { file, what } of toCheck) {
        if (!allowed.includes(file.type)) {
          throw new Error(`Your ${what} "${file.name}" is a ${file.type || 'unknown'} file. Use JPG, PNG, WebP, or AVIF.`)
        }
        if (file.size > MAX_BYTES) {
          throw new Error(`Your ${what} "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`)
        }
      }
```

- [ ] **Step 9: Show the warning on the success screen**

In the `if (done)` block, immediately after the closing `</div>` of the heading block (after the `<p>` that ends "…once it's live."), insert:

```tsx
        {warning && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm max-w-md mx-auto text-left">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {warning}
          </div>
        )}
```

`AlertCircle` is already imported at the top of the file.

- [ ] **Step 10: Verify the fix with the same forced failure**

Re-add the temporary `throw new Error('FORCED FAILURE — remove me')` in the same place as Step 2. Run the wizard with title `ProbeBrand Dup Test`, submit, see the error, submit again.

Run: `node <scratchpad>/verify-no-duplicates.mjs "ProbeBrand Dup Test"`
Expected: `PASS: exactly one listing row`, and the image count on that row equals the number of photos chosen (proving photos were not re-uploaded).

Repeat with the forced failure moved into the verification block instead, and confirm the run now reaches the success screen with the amber warning rather than an error banner.

- [ ] **Step 11: Remove the forced failure and clean up probe data**

Delete the `throw new Error('FORCED FAILURE — remove me')` line. Confirm it is gone:

```bash
grep -n "FORCED FAILURE" src/components/host/ListingWizard.tsx   # must print nothing
```

Delete the probe rows with the cleanup command from Step 2.

- [ ] **Step 12: Delete the production duplicate**

Remove the abandoned `16:36:37` attempt and its three orphaned storage objects. The surviving row is `654bfee2-586d-4e18-9138-fcc48cc3fe07`; the one to delete is `924ca665-bcde-4039-af36-b92f65723d49`.

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
const H={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const DEAD='924ca665-bcde-4039-af36-b92f65723d49';
(async()=>{
  const rows=await (await fetch(url+'/rest/v1/listings?select=id,images&id=eq.'+DEAD,{headers:H})).json();
  if(rows.length!==1){console.error('ABORT: expected 1 row, got',rows.length);process.exit(1)}
  const bookings=await (await fetch(url+'/rest/v1/bookings?select=id&listing_id=eq.'+DEAD,{headers:H})).json();
  if(bookings.length){console.error('ABORT: listing has bookings',bookings);process.exit(1)}
  const paths=rows[0].images.map(u=>u.split('/listing-images/')[1]).filter(Boolean);
  const del=await fetch(url+'/storage/v1/object/listing-images',{method:'DELETE',headers:H,body:JSON.stringify({prefixes:paths})});
  console.log('storage delete',del.status);
  const r=await fetch(url+'/rest/v1/listings?id=eq.'+DEAD,{method:'DELETE',headers:H});
  console.log('row delete',r.status);
})();
"
```

Then confirm exactly one remains:

```bash
node <scratchpad>/verify-no-duplicates.mjs "Canon G7X Mark III"
```
Expected: `PASS: exactly one listing row`

- [ ] **Step 13: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Make the listing wizard's submit idempotent so a retry cannot duplicate a listing"
```

---

## Task 4: Verification publish gate (database)

**Files:**
- Create: `supabase/migrations/037_gate_listings_on_verification.sql`
- Verify: scratchpad script `verify-gate.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - trigger `listings_force_draft_when_unverified` (BEFORE INSERT on `listings`)
  - trigger `listings_block_self_publish` (BEFORE UPDATE on `listings`)
  - `review_verification_request(uuid, boolean, text)` — same signature, now also publishes the host's pending listings on approval.

**Background:** The wizard inserts into `listings` directly (there is no `create_listing` RPC) and `authenticated` holds `insert, update, delete` on the table (migration `004`), so a client-side gate would be trivially bypassable. Enforcement must be in the database. This reuses `is_draft`, which every public read path already excludes (RLS policy `003`, `create_booking`, `searchListings`, home/host-profile/detail queries, `increment_listing_view`). Policy `"listings: host read own"` already lets a host see their own drafts, so My Listings needs no query change.

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-gate.mjs`. It uses a real signed-in session for the unverified host so RLS and the triggers both apply:

```js
import fs from 'node:fs'
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const URL = g('NEXT_PUBLIC_SUPABASE_URL'), ANON = g('NEXT_PUBLIC_SUPABASE_ANON_KEY'), KEY = g('SUPABASE_SECRET_KEY')
const SVC = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

let failed = 0
const check = (n, c) => { if (!c) { console.error('FAIL:', n); failed++ } else console.log('ok:', n) }

// Sign the demo host in, then force them unverified for the duration of the test.
const HOST = 'a0000000-0000-4000-8000-0000000000ff'
const before = (await (await fetch(`${URL}/rest/v1/profiles?select=is_verified&id=eq.${HOST}`, { headers: SVC })).json())[0]
await fetch(`${URL}/rest/v1/profiles?id=eq.${HOST}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ is_verified: false }) })

const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@demo.rentivo.ph', password: 'DemoRentivo1' }),
})).json()
const USER = { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' }

// 1. An unverified host's insert must be forced to draft, even when they ask for is_draft:false.
const ins = await fetch(`${URL}/rest/v1/listings`, {
  method: 'POST', headers: { ...USER, Prefer: 'return=representation' },
  body: JSON.stringify({
    host_id: HOST, category: 'mirrorless', brand: 'GateProbe', model: 'One',
    title: 'GateProbe One', description: 'gate probe', condition: 'good',
    daily_price: 500, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
    is_draft: false,
  }),
})
const row = (await ins.json())[0]
check('insert succeeded', ins.ok)
check('unverified host insert forced to draft', row?.is_draft === true)

// 2. The host must not be able to publish it themselves.
await fetch(`${URL}/rest/v1/listings?id=eq.${row.id}`, { method: 'PATCH', headers: USER, body: JSON.stringify({ is_draft: false }) })
const after = (await (await fetch(`${URL}/rest/v1/listings?select=is_draft&id=eq.${row.id}`, { headers: SVC })).json())[0]
check('self-publish blocked', after?.is_draft === true)

// 3. Approving the host's ID must publish it.
const vr = (await (await fetch(`${URL}/rest/v1/verification_requests`, {
  method: 'POST', headers: { ...SVC, Prefer: 'return=representation' },
  body: JSON.stringify({ user_id: HOST, id_doc_path: 'probe/id.jpg', selfie_path: 'probe/selfie.jpg' }),
})).json())[0]
await fetch(`${URL}/rest/v1/rpc/review_verification_request`, {
  method: 'POST', headers: SVC,
  body: JSON.stringify({ p_request_id: vr.id, p_approve: true, p_notes: 'gate probe' }),
})
const published = (await (await fetch(`${URL}/rest/v1/listings?select=is_draft&id=eq.${row.id}`, { headers: SVC })).json())[0]
check('approval auto-publishes pending listings', published?.is_draft === false)

// Cleanup — restore everything this script touched.
await fetch(`${URL}/rest/v1/listings?id=eq.${row.id}`, { method: 'DELETE', headers: SVC })
await fetch(`${URL}/rest/v1/verification_requests?id=eq.${vr.id}`, { method: 'DELETE', headers: SVC })
await fetch(`${URL}/rest/v1/profiles?id=eq.${HOST}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ is_verified: before.is_verified }) })
process.exit(failed ? 1 : 0)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node <scratchpad>/verify-gate.mjs`
Expected: `FAIL: unverified host insert forced to draft`, `FAIL: self-publish blocked`, and `FAIL: approval auto-publishes pending listings` — no gate exists yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/037_gate_listings_on_verification.sql`:

```sql
-- ============================================================
-- 037_gate_listings_on_verification.sql
-- A listing went live the instant it was inserted, regardless of whether
-- the host's ID had been verified. The wizard inserts into `listings`
-- directly (there is no create_listing RPC) and `authenticated` holds
-- insert/update on the table (004), so a client-side gate would be
-- trivially bypassable — enforcement has to live here.
--
-- Reuses the existing `is_draft` column rather than adding new state:
-- every public read path already excludes drafts (RLS 003, create_booking,
-- searchListings, the home/host-profile/detail queries, and
-- increment_listing_view), and "listings: host read own" already lets a
-- host see their own drafts.
-- ============================================================

-- ── 1. Verify the seed/demo hosts FIRST ──────────────────────
-- Four of nineteen hosts are unverified, two of them seed fixtures
-- (Andrei Flores / Google Pixel 9 Pro, Lea Villanueva / Sony 24-70mm).
-- These exist to make the marketplace look populated. Verifying them
-- before the retroactive sweep below is what keeps the storefront intact;
-- reversing this order would pull real seed listings out of search.
update public.profiles
set is_verified = true
where id in (
  'a0000000-0000-4000-8000-000000000012',  -- Andrei Flores
  'a0000000-0000-4000-8000-000000000004',  -- Lea Villanueva
  'a0000000-0000-4000-8000-0000000000ff'   -- Demo User (e2e host)
);

-- ── 2. New listings from unverified hosts start hidden ───────
create or replace function public.force_draft_when_unverified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.host_id and is_verified = true
  ) then
    new.is_draft := true;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_force_draft_when_unverified on public.listings;
create trigger listings_force_draft_when_unverified
  before insert on public.listings
  for each row execute function public.force_draft_when_unverified();

-- ── 3. An unverified host cannot publish their own draft ─────
create or replace function public.block_self_publish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Service role (admin panel, security-definer RPCs, migrations) is exempt,
  -- matching enforce_booking_transition's precedent in 004.
  if auth.uid() is null then
    return new;
  end if;

  if old.is_draft = true and new.is_draft = false then
    if not exists (
      select 1 from public.profiles
      where id = new.host_id and is_verified = true
    ) then
      raise exception 'Your listing goes live once your ID is verified.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_block_self_publish on public.listings;
create trigger listings_block_self_publish
  before update on public.listings
  for each row execute function public.block_self_publish();

-- ── 4. Approving an ID publishes that host's pending listings ─
-- Full body copied from 018's authoritative version; the only addition is
-- the listings update inside the `if p_approve` branch. Note the ordering:
-- is_verified is set BEFORE the listings are published. The trigger above
-- exempts the service role so either order would work, but relying on that
-- bypass rather than on the host genuinely being verified would make this
-- function correct by accident.
create or replace function public.review_verification_request(
  p_request_id uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns public.verification_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.verification_requests;
begin
  update public.verification_requests
  set status         = case when p_approve then 'approved'::verification_status else 'rejected'::verification_status end,
      reviewer_notes = p_notes,
      reviewed_at    = now()
  where id = p_request_id
  returning * into v_request;

  if not found then
    raise exception 'Verification request not found.';
  end if;

  if p_approve then
    update public.profiles set is_verified = true where id = v_request.user_id;

    update public.listings
    set is_draft = false
    where host_id = v_request.user_id and is_draft = true;
  end if;

  return v_request;
end;
$$;

revoke execute on function public.review_verification_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_verification_request(uuid, boolean, text) to service_role;

-- ── 5. Retroactive sweep ─────────────────────────────────────
-- After step 1 this affects only genuinely unverified hosts.
update public.listings l
set is_draft = true
where l.is_draft = false
  and not exists (
    select 1 from public.profiles p
    where p.id = l.host_id and p.is_verified = true
  );
```

- [ ] **Step 4: Apply and re-run**

```bash
supabase db push --linked --yes
supabase migration list --linked   # confirm 037 applied
node <scratchpad>/verify-gate.mjs
```
Expected: all four checks print `ok:` and the script exits 0.

- [ ] **Step 5: Confirm the seed storefront survived**

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
const H={apikey:key,Authorization:'Bearer '+key};
(async()=>{
  const live=await (await fetch(url+'/rest/v1/listings?select=id,title,is_draft&is_draft=eq.false&is_active=eq.true',{headers:H})).json();
  const hidden=await (await fetch(url+'/rest/v1/listings?select=id,title&is_draft=eq.true',{headers:H})).json();
  console.log('live:',live.length); console.log('hidden:',hidden.map(x=>x.title));
})();
"
```
Expected: the Pixel 9 Pro and Sony 24-70mm listings are **live**, and only the genuinely unverified host's listing is hidden. If a seed listing is hidden, step 1 of the migration missed a host id — fix and re-apply before continuing.

- [ ] **Step 6: Confirm the draft is invisible to the public**

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),anon=g('NEXT_PUBLIC_SUPABASE_ANON_KEY');
fetch(url+'/rest/v1/listings?select=id,title&is_draft=eq.true',{headers:{apikey:anon,Authorization:'Bearer '+anon}})
  .then(r=>r.json()).then(d=>console.log('anon sees',d.length,'draft(s) — must be 0'));
"
```
Expected: `anon sees 0 draft(s) — must be 0`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Gate listing publication on admin ID verification"
```

---

## Task 5: Verification gate (host-facing UI)

**Files:**
- Modify: `src/app/(main)/dashboard/listings/page.tsx:96-101`, `src/components/host/ListingWizard.tsx` (success screen)
- Verify: browser walkthrough

**Interfaces:**
- Consumes: `listings.is_draft` from Task 4; `useMyListings()` already selects it via `HOST_SELECT`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm `is_draft` reaches the client**

```bash
grep -n "is_draft" src/lib/listings.ts src/lib/listing-columns.ts
```

If `is_draft` is **not** in `LISTING_COLUMNS`, add it — the badge cannot render a field the allowlist strips. Insert it after `is_active`:

```ts
  'id, host_id, category, brand, model, title, description, condition, daily_price, weekly_price, monthly_price, security_deposit, city, province, is_instant_book, is_active, is_draft, rating, review_count, view_count, images, accessories, created_at'
```

Also add `is_draft: boolean` to the `Listing` interface in `src/types/index.ts`, after `is_active: boolean`.

- [ ] **Step 2: Add the pending-review badge**

In `src/app/(main)/dashboard/listings/page.tsx`, replace the status badge block (currently lines 96-101):

```tsx
                    <span className={`shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                      listing.is_active ? 'bg-green-50 text-[#22C55E]' : 'bg-gray-100 text-gray-500'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${listing.is_active ? 'bg-[#22C55E]' : 'bg-gray-400'}`} />
                      {listing.is_active ? 'Active' : 'Paused'}
                    </span>
```

with:

```tsx
                    {listing.is_draft ? (
                      <span className="shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Pending review
                      </span>
                    ) : (
                      <span className={`shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                        listing.is_active ? 'bg-green-50 text-[#22C55E]' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${listing.is_active ? 'bg-[#22C55E]' : 'bg-gray-400'}`} />
                        {listing.is_active ? 'Active' : 'Paused'}
                      </span>
                    )}
```

- [ ] **Step 3: Explain the hold on the listings page**

Directly above the listings grid in the same file, add a banner shown only when at least one listing is pending. Add this derived value next to the existing `activeCount`:

```ts
  const pendingCount = listings.filter((l) => l.is_draft).length
```

and render, immediately before the grid:

```tsx
      {pendingCount > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-6">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {pendingCount === 1 ? 'One listing is' : `${pendingCount} listings are`} waiting on ID verification.
          They go live automatically once an admin approves your ID.
        </div>
      )}
```

Add `AlertCircle` to the file's existing `lucide-react` import.

- [ ] **Step 4: Make the wizard's success copy honest**

The success screen currently promises activation "within 24 hours" unconditionally. In `src/components/host/ListingWizard.tsx`, track whether the host was verified at submit time. Add next to the other state:

```ts
  const [hostVerified, setHostVerified] = useState(true)
```

In `handleSubmit`, immediately after the `if (!user) throw ...` line, add:

```ts
      const { data: hostProfile } = await supabase
        .from('profiles')
        .select('is_verified')
        .eq('id', user.id)
        .single()
      setHostVerified(Boolean(hostProfile?.is_verified))
```

Then in the `done` screen, replace the heading and paragraph:

```tsx
          <h2 className="text-3xl font-bold text-[#111827]">Listing submitted!</h2>
          <p className="text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
            Your listing is under review. We&apos;ll verify your details and activate it within <strong>24 hours</strong>. You&apos;ll get an email once it&apos;s live.
          </p>
```

with:

```tsx
          <h2 className="text-3xl font-bold text-[#111827]">
            {hostVerified ? 'Your listing is live!' : 'Listing submitted!'}
          </h2>
          <p className="text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
            {hostVerified
              ? <>Your listing is now visible to renters. You can edit or pause it anytime from <strong>My Listings</strong>.</>
              : <>Your listing is saved but stays <strong>hidden</strong> until an admin approves your ID. It goes live automatically the moment that happens.</>}
          </p>
```

And replace the "What happens next?" list items so they match reality:

```tsx
          {(hostVerified
            ? [
                'Your listing is live and searchable now',
                'Renters can find and book your gear',
                'You approve or decline each booking request',
                'You get paid within 2 days of return',
              ]
            : [
                'An admin reviews your ID documents',
                'Your listing goes live as soon as it’s approved',
                'Renters can then find and book your gear',
                'You get paid within 2 days of return',
              ]
          ).map((s, i) => (
```

Also hide the "Preview Listing" link for an unverified host, since the public page will 404 for them. Wrap it:

```tsx
          {hostVerified && (
            <Link href={`/listings/${listingId}`}
              className="flex items-center justify-center gap-2 border border-[#003049] text-[#003049] font-bold py-3 px-6 rounded-xl text-sm hover:bg-blue-50 transition-colors">
              <Eye className="w-4 h-4" /> Preview Listing
            </Link>
          )}
```

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

Temporarily set the demo host unverified:

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
fetch(url+'/rest/v1/profiles?id=eq.a0000000-0000-4000-8000-0000000000ff',{method:'PATCH',
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
 body:JSON.stringify({is_verified:false})}).then(r=>console.log(r.status));
"
```

Sign in as the demo host, create a listing, and confirm: the success screen says the listing stays hidden, there is no Preview link, `/dashboard/listings` shows the amber "Pending review" badge and the banner, and the listing does not appear in `/search`. Then approve the host through `/admin/verifications` and confirm the listing flips to Active and appears in search.

Restore the host's verified state afterwards (same command with `is_verified:true`) and delete the test listing.

- [ ] **Step 6: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Surface pending-review state to hosts in the wizard and My Listings"
```

---

## Task 6: Delivery fee (database)

**Files:**
- Create: `supabase/migrations/038_delivery_fee.sql`
- Verify: scratchpad script `verify-delivery-fee.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `listings.delivery_fee integer null` — `null` = delivery not offered, `0` = free, `> 0` = flat fee
  - `bookings.delivery_fee integer not null default 0`
  - `create_booking(...)` — unchanged signature, now adds the listing's delivery fee to `total_amount` when `p_is_delivery`
  - `request_payout()` — unchanged signature, now pays hosts `rental_fee + delivery_fee`

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/verify-delivery-fee.mjs`:

```js
import fs from 'node:fs'
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim()
const URL = g('NEXT_PUBLIC_SUPABASE_URL'), ANON = g('NEXT_PUBLIC_SUPABASE_ANON_KEY'), KEY = g('SUPABASE_SECRET_KEY')
const SVC = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

let failed = 0
const check = (n, c, extra) => { if (!c) { console.error('FAIL:', n, extra ?? ''); failed++ } else console.log('ok:', n) }

// A seeded listing owned by a host the demo renter can book.
const LISTING = 'b0000000-0000-4000-8000-000000000001' // Sony A7 IV
const DELIVERY_FEE = 350

await fetch(`${URL}/rest/v1/listings?id=eq.${LISTING}`, {
  method: 'PATCH', headers: SVC, body: JSON.stringify({ delivery_fee: DELIVERY_FEE }),
})
const listing = (await (await fetch(`${URL}/rest/v1/listings?select=daily_price,security_deposit,delivery_fee&id=eq.${LISTING}`, { headers: SVC })).json())[0]
check('delivery_fee column exists and persists', listing?.delivery_fee === DELIVERY_FEE, listing)

const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'renter@demo.rentivo.ph', password: 'DemoRentivo1' }),
})).json()
const USER = { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' }

const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const created = []

async function book(isDelivery, from, to) {
  const r = await fetch(`${URL}/rest/v1/rpc/create_booking`, {
    method: 'POST', headers: USER,
    body: JSON.stringify({
      p_listing_id: LISTING, p_pickup_date: d(from), p_return_date: d(to),
      p_is_delivery: isDelivery, p_delivery_address: isDelivery ? '1 Test St, Manila' : null,
      p_payment_method: 'card',
    }),
  })
  const b = await r.json()
  if (r.ok && b?.id) created.push(b.id)
  return { ok: r.ok, b }
}

// 1. Delivery booking charges the fee and totals correctly.
const days = 3
const del = await book(true, 10, 10 + days)
check('delivery booking created', del.ok, del.b)
if (del.ok) {
  const b = del.b
  check('booking.delivery_fee matches listing', b.delivery_fee === DELIVERY_FEE, b.delivery_fee)
  const expected = b.rental_fee - b.discount + b.service_fee + b.protection_fee + b.delivery_fee + b.security_deposit
  check('total_amount includes delivery fee', b.total_amount === expected, { got: b.total_amount, expected })
  check('service fee is 5% of rental only', b.service_fee === Math.round(b.rental_fee * 0.05), b.service_fee)
}

// 2. Pickup on the same listing charges nothing extra.
const pick = await book(false, 30, 30 + days)
check('pickup booking created', pick.ok, pick.b)
if (pick.ok) check('pickup booking has no delivery fee', pick.b.delivery_fee === 0, pick.b.delivery_fee)

// 3. Delivery against a listing that does not offer it is rejected.
await fetch(`${URL}/rest/v1/listings?id=eq.${LISTING}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ delivery_fee: null }) })
const nodel = await book(true, 50, 50 + days)
check('delivery rejected when not offered', !nodel.ok && JSON.stringify(nodel.b).includes('does not offer delivery'), nodel.b)

// Cleanup
for (const id of created) await fetch(`${URL}/rest/v1/bookings?id=eq.${id}`, { method: 'DELETE', headers: SVC })
await fetch(`${URL}/rest/v1/listings?id=eq.${LISTING}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ delivery_fee: null }) })
process.exit(failed ? 1 : 0)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node <scratchpad>/verify-delivery-fee.mjs`
Expected: `FAIL: delivery_fee column exists and persists` — PostgREST rejects the unknown column.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/038_delivery_fee.sql`. Start from the **exact body** of `create_booking` in `035_lower_service_fee_drop_protection_fee.sql` and of `request_payout` in `033_exclude_test_skip_from_payouts.sql`, then apply only the changes marked below.

```sql
-- ============================================================
-- 038_delivery_fee.sql
-- Delivery had no price anywhere: no column, no term in create_booking,
-- nothing in the checkout total. The UI said "Fee may apply" and
-- "arranged directly with the host via messages", so a renter choosing
-- delivery saw a total that was not what they would actually pay.
--
-- listings.delivery_fee is NULLABLE on purpose — the three states are
-- distinct and a NOT NULL default of 0 would collapse two of them:
--   null  -> host does not offer delivery (checkout tile disabled)
--   0     -> free delivery
--   > 0   -> flat fee
-- bookings.delivery_fee is NOT NULL DEFAULT 0 so historical bookings keep
-- honest, unchanged receipts (same approach 035 took for protection_fee).
-- ============================================================

alter table public.listings
  add column if not exists delivery_fee integer check (delivery_fee >= 0);

alter table public.bookings
  add column if not exists delivery_fee integer not null default 0 check (delivery_fee >= 0);

comment on column public.listings.delivery_fee is
  'Flat delivery fee in PHP. NULL = host does not offer delivery; 0 = free delivery.';

-- 004 grants insert on bookings column-by-column; a column missing from
-- that list is silently unwritable.
grant insert (
  listing_id, renter_id, host_id, pickup_date, return_date,
  rental_fee, security_deposit, service_fee, protection_fee, delivery_fee,
  total_amount, is_delivery, delivery_address, payment_method, renter_notes
) on public.bookings to authenticated;

-- ── create_booking ───────────────────────────────────────────
-- Body copied verbatim from 035, with four changes, all marked "038:".
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

-- ── request_payout ───────────────────────────────────────────
-- Body copied verbatim from 033. The eligible CTE summed rental_fee alone
-- in three places; the renter pays the delivery fee to the host through
-- Rentivo, so leaving it out would make the host absorb every delivery.
create or replace function public.request_payout()
returns public.payout_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_request public.payout_requests;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_account from public.payout_accounts where user_id = auth.uid();
  if not found or v_account.status != 'verified' then
    raise exception 'You need a verified payout account before requesting a payout.';
  end if;

  if exists (select 1 from public.payout_requests where host_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a payout request in progress.';
  end if;

  with eligible as (
    select b.id, b.rental_fee + b.delivery_fee as payable   -- 038
    from public.bookings b
    where b.host_id = auth.uid()
      and b.status = 'completed'
      and b.payment_status = 'paid'
      and b.payment_method is distinct from 'host_qr'
      and b.payment_method is distinct from 'test_skip'
      and not exists (
        select 1
        from public.payout_items pi
        join public.payout_requests pr on pr.id = pi.payout_request_id
        where pi.booking_id = b.id and pr.status in ('pending', 'paid')
      )
  ),
  new_request as (
    insert into public.payout_requests (host_id, payout_account_id, amount, status)
    select auth.uid(), v_account.id, coalesce(sum(eligible.payable), 0), 'pending'
    from eligible
    having coalesce(sum(eligible.payable), 0) > 0
    returning *
  ),
  items as (
    insert into public.payout_items (payout_request_id, booking_id, amount)
    select new_request.id, eligible.id, eligible.payable
    from eligible, new_request
    returning *
  )
  select * into v_request from new_request;

  if not found then
    raise exception 'No available balance to pay out.';
  end if;

  return v_request;
end;
$$;
```

- [ ] **Step 4: Apply and re-run**

```bash
supabase db push --linked --yes
supabase migration list --linked   # confirm 038 applied
node <scratchpad>/verify-delivery-fee.mjs
```
Expected: every check prints `ok:` and the script exits 0.

- [ ] **Step 5: Confirm no historical booking was disturbed**

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
fetch(url+'/rest/v1/bookings?select=id,rental_fee,service_fee,protection_fee,delivery_fee,security_deposit,discount,total_amount',{headers:{apikey:key,Authorization:'Bearer '+key}})
 .then(r=>r.json()).then(rows=>{
   const bad=rows.filter(b=>b.total_amount!==b.rental_fee-b.discount+b.service_fee+b.protection_fee+b.delivery_fee+b.security_deposit);
   console.log(rows.length,'bookings;',bad.length,'with a total that does not reconcile');
   if(bad.length) console.log(bad);
 });
"
```
Expected: `0 with a total that does not reconcile` — every pre-existing booking has `delivery_fee = 0`, so the identity holds unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add a host-set delivery fee to booking pricing and payouts"
```

---

## Task 7: Delivery fee (application)

**Files:**
- Modify: `src/lib/pricing.ts`, `src/lib/listing-columns.ts`, `src/types/index.ts`, `src/components/host/Step3Pricing.tsx`, `src/components/host/ListingWizard.tsx`, `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`, `src/components/booking/Step2Pickup.tsx`, `src/components/booking/OrderSummary.tsx`, `src/components/booking/Step3Payment.tsx`, `src/components/booking/BookingWizard.tsx`, `src/components/booking/Step4Confirmation.tsx`
- Verify: browser walkthrough of a full delivery checkout

**Interfaces:**
- Consumes: `listings.delivery_fee`, `bookings.delivery_fee` from Task 6.
- Produces: `calcPricing(listing, days, isDelivery?)` — third parameter is optional and defaults to `false`, so the existing `BookingPanel` call site needs no change.

- [ ] **Step 1: Add the column to the read allowlist and types**

In `src/lib/listing-columns.ts`, add `delivery_fee` to `LISTING_COLUMNS` after `security_deposit`:

```ts
export const LISTING_COLUMNS =
  'id, host_id, category, brand, model, title, description, condition, daily_price, weekly_price, monthly_price, security_deposit, delivery_fee, city, province, is_instant_book, is_active, is_draft, rating, review_count, view_count, images, accessories, created_at'
```

In `src/types/index.ts`, add to `Listing` after `security_deposit: number`:

```ts
  delivery_fee: number | null
```

and to `Booking` after `protection_fee: number`:

```ts
  delivery_fee: number
```

- [ ] **Step 2: Mirror the fee in the shared pricing helper**

In `src/lib/pricing.ts`, add `delivery_fee` to `PricedListing` and thread it through `calcPricing`:

```ts
export interface PricedListing {
  daily_price: number
  weekly_price: number | null
  monthly_price: number | null
  security_deposit: number
  delivery_fee: number | null
}
```

```ts
/**
 * Mirrors create_booking (038). The delivery fee is charged only when the
 * renter picks delivery, and the service fee is NOT charged on it — it is a
 * pass-through to the host.
 */
export function calcPricing(listing: PricedListing, days: number, isDelivery = false) {
  const { rentalFee, tier } = calcRentalFee(listing, days)
  const serviceFee = Math.round(rentalFee * SERVICE_FEE_RATE)
  const deliveryFee = isDelivery ? (listing.delivery_fee ?? 0) : 0
  const total = rentalFee + serviceFee + deliveryFee + listing.security_deposit
  return { rentalFee, tier, serviceFee, deliveryFee, total }
}
```

- [ ] **Step 3: Let hosts set the fee in the wizard**

In `src/components/host/Step3Pricing.tsx`, add `deliveryFee: string` to the `PricingData` interface, then add this field immediately after the Security Deposit block and before the nav buttons:

```tsx
      {/* Delivery fee */}
      <div>
        <label className={label}>Delivery Fee</label>
        <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 bg-white">
          <span className="px-4 text-gray-400 font-semibold text-sm border-r border-gray-200 py-3">₱</span>
          <input
            value={data.deliveryFee}
            onChange={e => set('deliveryFee', e.target.value)}
            inputMode="numeric"
            placeholder="Leave blank if you don't deliver"
            className="flex-1 px-4 py-3 text-sm text-gray-800 outline-none bg-transparent"
          />
        </div>
        <div className="flex items-start gap-2 mt-2 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Leave this blank if you only do pickup — renters won&apos;t see a delivery option.
          Enter <strong>0</strong> to offer free delivery. This is added to the renter&apos;s total and paid to you in full.
        </div>
      </div>
```

Note `set()` in this file strips non-digits (`val.replace(/\D/g, '')`), which is what keeps `''` and `'0'` distinguishable — an empty string stays empty.

- [ ] **Step 4: Persist it from the wizard**

In `src/components/host/ListingWizard.tsx`:

Add `deliveryFee: string` to the `pricing` shape in `WizardState`, and `deliveryFee: ''` to `INITIAL.pricing`.

In the `fields` object built in Task 3 Step 6, add after `security_deposit`:

```ts
        delivery_fee: pricing.deliveryFee === '' ? null : Number(pricing.deliveryFee),
```

- [ ] **Step 5: Add the field to the edit page**

In `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`:

Add state next to the other pricing fields:

```ts
  const [deliveryFee, setDeliveryFee] = useState('')
```

Populate it in the loader next to `setDeposit(...)`:

```ts
    setDeliveryFee(data.delivery_fee != null ? String(data.delivery_fee) : '')
```

Persist it in the save payload next to `security_deposit`:

```ts
        delivery_fee: deliveryFee === '' ? null : Number(deliveryFee),
```

And render an input beside the deposit field, with the same "blank means no delivery, 0 means free" helper copy as Step 3.

- [ ] **Step 6: Show the real fee at pickup/delivery choice**

In `src/components/booking/Step2Pickup.tsx`, replace the delivery tile's hardcoded copy:

```tsx
            <p className="text-xs text-gray-500 mt-1">Host delivers to your location</p>
            <p className="text-xs font-semibold text-amber-600 mt-2">Fee may apply</p>
```

with:

```tsx
            <p className="text-xs text-gray-500 mt-1">
              {offersDelivery ? 'Host delivers to your location' : 'Not offered by this host'}
            </p>
            {offersDelivery && (
              <p className={`text-xs font-semibold mt-2 ${deliveryFee > 0 ? 'text-[#003049]' : 'text-[#22C55E]'}`}>
                {deliveryFee > 0 ? `₱${deliveryFee.toLocaleString()}` : 'Free'}
              </p>
            )}
```

Add these derived values at the top of the component:

```ts
  const offersDelivery = listing.delivery_fee !== null
  const deliveryFee = listing.delivery_fee ?? 0
```

Disable the tile when delivery is not offered by adding to its `<button>`:

```tsx
          disabled={!offersDelivery}
```

and appending `disabled:opacity-50 disabled:cursor-not-allowed` to its className.

Replace the delivery-address helper text:

```tsx
          <p className="text-xs text-gray-400">
            Delivery fee will be arranged directly with the host via messages.
          </p>
```

with:

```tsx
          <p className="text-xs text-gray-400">
            {deliveryFee > 0
              ? `A ₱${deliveryFee.toLocaleString()} delivery fee is included in your total.`
              : 'This host delivers for free.'}
          </p>
```

- [ ] **Step 7: Show it in the order summary**

In `src/components/booking/OrderSummary.tsx`, change the destructure to pull the fee and pass the flag:

```ts
  const { rentalFee, tier, serviceFee, deliveryFee, total } = calcPricing(listing, days, isDelivery)
```

and insert a row after the service-fee row:

```tsx
        {deliveryFee > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>Delivery fee</span>
            <span>₱{deliveryFee.toLocaleString()}</span>
          </div>
        )}
```

- [ ] **Step 8: Include it in the amount actually charged**

`Step3Payment` computes the total the renter pays, and does not currently know whether delivery was chosen.

In `src/components/booking/Step3Payment.tsx`, add `isDelivery: boolean` to `Step3PaymentProps`, accept it in the signature:

```ts
export function Step3Payment({ listing, days, isDelivery, onNext, onBack }: Step3PaymentProps) {
```

and pass it through:

```ts
  const { rentalFee, total: baseTotal } = calcPricing(listing, days, isDelivery)
```

In `src/components/booking/BookingWizard.tsx`, pass the prop where `Step3Payment` is rendered:

```tsx
                  isDelivery={isDelivery}
```

- [ ] **Step 9: Show it on the receipt**

In `src/components/booking/Step4Confirmation.tsx`, insert after the protection-fee block (which is already conditionally rendered):

```tsx
          {booking.delivery_fee > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Delivery fee</span>
              <span>₱{booking.delivery_fee.toLocaleString()}</span>
            </div>
          )}
```

Conditional rendering matters here for the same reason it did for the protection fee in `035`: pre-migration bookings have `delivery_fee = 0` and must not show a spurious ₱0 line.

- [ ] **Step 10: Walk a full delivery checkout in the browser**

```bash
npm run dev
```

Set a fee on a seeded listing:

```bash
node -e "
const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');
const g=k=>{const m=e.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():null};
const url=g('NEXT_PUBLIC_SUPABASE_URL'),key=g('SUPABASE_SECRET_KEY');
fetch(url+'/rest/v1/listings?id=eq.b0000000-0000-4000-8000-000000000001',{method:'PATCH',
 headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
 body:JSON.stringify({delivery_fee:350})}).then(r=>console.log(r.status));
"
```

Signed in as the demo renter, book that listing and confirm: the Delivery tile shows ₱350, the order summary gains a ₱350 "Delivery fee" row, the total rises by exactly 350 versus choosing Pickup, and the confirmation receipt shows the row. Then check a listing with `delivery_fee` still null and confirm its Delivery tile is disabled and reads "Not offered by this host".

Reset the seeded listing to `delivery_fee: null` afterwards and delete any test bookings.

- [ ] **Step 11: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Surface the delivery fee across the host wizard and renter checkout"
```

---

## Task 8: Payment method availability

**Files:**
- Modify: `src/components/booking/Step3Payment.tsx:34-49` and `:94`, `:382`; `.env.local`; Vercel production env
- Verify: browser check of the payment step

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

**Background:** `gcash`, `maya`, and `card` are **Submitted** (awaiting KYB approval) on the live PayMongo account; only `qrph` is **Active**. The code path is the same `PaymentIntent → PaymentMethod → attach` flow `qrph` uses successfully, so this is an account issue, not a defect. The work is making the dead end visible and reversible without a deploy.

- [ ] **Step 1: Read availability from the environment**

In `src/components/booking/Step3Payment.tsx`, add below the existing `PAYMONGO_PUBLIC_KEY` constant:

```ts
// PayMongo activates payment methods per-merchant after KYB review. Methods
// listed here render as unavailable rather than failing at attach time.
// Clearing the env var re-enables them with no code deploy.
const DISABLED_METHODS = (process.env.NEXT_PUBLIC_DISABLED_PAYMENT_METHODS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
```

- [ ] **Step 2: Mark the disabled tiles**

Replace the `methods` derivation:

```ts
  const hasHostQr = Boolean(listing.host?.qr_payment_url)
  const methods = hasHostQr
    ? [...BASE_METHODS, { id: 'host_qr' as const, label: 'GCash/Maya QR (Direct to Host)', logo: '', color: 'border-purple-400' }]
    : BASE_METHODS
```

with:

```ts
  const hasHostQr = Boolean(listing.host?.qr_payment_url)
  const methods = (hasHostQr
    ? [...BASE_METHODS, { id: 'host_qr' as const, label: 'GCash/Maya QR (Direct to Host)', logo: '', color: 'border-purple-400' }]
    : BASE_METHODS
  ).map((m) => (DISABLED_METHODS.includes(m.id) ? { ...m, comingSoon: true, unavailable: true } : m))
```

Add `unavailable?: boolean` to the `BASE_METHODS` type annotation, alongside the existing `comingSoon?: boolean`:

```ts
const BASE_METHODS: {
  id: PaymentMethod
  label: string
  logo: string
  color: string
  comingSoon?: boolean
  unavailable?: boolean
}[] = [
```

The `host_qr` object literal appended in `methods` has neither field. Give it both explicitly so every element of the array has the same shape and TypeScript infers one object type rather than a union — otherwise `m.unavailable` fails to typecheck on the union branch:

```ts
    ? [...BASE_METHODS, { id: 'host_qr' as const, label: 'GCash/Maya QR (Direct to Host)', logo: '', color: 'border-purple-400', comingSoon: false, unavailable: false }]
```

The tiles already render `disabled={m.comingSoon}`. Change the badge text so an unavailable method does not read as a future feature — replace the `Coming soon` label with:

```tsx
                  {m.unavailable ? 'Unavailable' : 'Coming soon'}
```

- [ ] **Step 3: Fix the default selection**

`useState<PaymentMethod>('gcash')` opens checkout pre-selected on a tile that may now be disabled. Replace:

```ts
  const [method, setMethod] = useState<PaymentMethod>('gcash')
```

with:

```ts
  const [method, setMethod] = useState<PaymentMethod>(
    () => (['gcash', 'maya', 'card', 'qrph'] as const).find((m) => !DISABLED_METHODS.includes(m)) ?? 'qrph'
  )
```

- [ ] **Step 4: Fix the invisible promo button**

At line 382 the promo Apply button is `bg-[#FDF0D5] hover:bg-orange-600 … text-white` — white text on the cream accent, effectively invisible. `#FDF0D5` is a background-only color in this design system. Change its className to:

```tsx
                className="px-4 py-2.5 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm rounded-xl transition-colors"
```

- [ ] **Step 5: Set the env var in both places**

Add to `.env.local`:

```
NEXT_PUBLIC_DISABLED_PAYMENT_METHODS=gcash,maya,card
```

And in Vercel production:

```bash
vercel env add NEXT_PUBLIC_DISABLED_PAYMENT_METHODS production
# paste: gcash,maya,card
```

- [ ] **Step 6: Verify in the browser**

Restart `npm run dev` (a `NEXT_PUBLIC_*` change requires a restart). Start a booking and confirm on the payment step: GCash, Maya, and Card render greyed out with an "Unavailable" badge and cannot be selected; QR Ph is selected by default; the promo Apply button is legible; and a QR Ph checkout still reaches PayMongo and renders a QR image.

- [ ] **Step 7: Document the switch**

In `AGENTS.md`, under the PayMongo blocker bullet in **To Do**, append:

```
  As of 2026-09-02 these three are hidden from checkout via `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS=gcash,maya,card` (set in `.env.local` and Vercel production) so renters aren't sent down a dead end. **When PayMongo flips them to Active, remove the value from that env var and redeploy — no code change needed.**
```

- [ ] **Step 8: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "Hide payment methods PayMongo hasn't activated instead of failing at attach"
```

---

## Final pass

- [ ] **Update `AGENTS.md`'s Status section**

Add one entry per workstream to **Status — Done**, in this project's established style: what was wrong, the root cause, what changed, what was verified live, and what was deliberately left out. Be explicit about anything that was *not* live-verified.

- [ ] **Full regression walkthrough**

With a production build (`npm run build && npm start`), walk: home → search (list and map) → a listing detail page → a full booking through checkout → the renter dashboard; then the host dashboard, My Listings, the listing wizard, and `/admin`. Confirm no console errors and no CSP violations.

- [ ] **Confirm the migrations landed**

```bash
supabase migration list --linked
```
Expected: `036`, `037`, and `038` all show as applied to the remote.
