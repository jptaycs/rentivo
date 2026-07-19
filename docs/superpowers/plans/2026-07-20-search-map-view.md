# Search Results Map View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A List ⇄ Map toggle on `/search` that swaps the results grid for a Leaflet map with one marker per city, each popup listing that city's matching listings.

**Architecture:** New `SearchMap.tsx` (dynamic `ssr:false` wrapper) + `SearchMapLeaflet.tsx` in `src/components/search/`, mirroring the shipped `PickupMap`/`PickupMapLeaflet` pattern — the pickup map is NOT touched. `SearchResults.tsx` gains a `view` state and segmented control; map mode renders the already-filtered `results` array. City-level coordinates only (existing `getCityCoordinates`), preserving the privacy model.

**Tech Stack:** Next.js 16 / React 19, Leaflet + OpenStreetMap tiles (already a dependency), Tailwind 4, lucide-react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-search-map-view-design.md`
- No test framework — verification is `npm run build` + `npm run lint` (repo has pre-existing `react-hooks/set-state-in-effect` lint errors; introduce NO new lint issues) + live browser check.
- Leaflet touches `window`: `SearchMapLeaflet` must only be loaded via `next/dynamic` with `ssr: false`. Never import it into a Server Component.
- Popup HTML is built as strings — every user-authored value (titles, cities) MUST pass through an HTML-escape helper before interpolation.
- One marker per `city|province` group, never per listing (city-level coords mean same-city listings share a point).
- Primary color `#003049`; currency format `₱X,XXX/day`.
- Commit per task, imperative subjects, commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: SearchMap components

**Files:**
- Create: `src/components/search/SearchMapLeaflet.tsx`
- Create: `src/components/search/SearchMap.tsx`

**Interfaces:**
- Consumes: `getCityCoordinates(city: string, province: string): { lat: number; lng: number }` from `src/lib/ph-locations.ts`; `Listing` type from `src/types` (`id`, `title`, `daily_price`, `city`, `province`, `images: string[]`).
- Produces: `SearchMap` named export, props `{ listings: Listing[] }` — Task 2 renders it.

- [ ] **Step 1: Create `src/components/search/SearchMapLeaflet.tsx`**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { getCityCoordinates } from '@/lib/ph-locations'
import type { Listing } from '@/types'

interface SearchMapLeafletProps {
  listings: Listing[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default function SearchMapLeaflet({ listings }: SearchMapLeafletProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return

      // Group listings by city — city-level coords mean same-city listings share one point
      const groups = new Map<string, { city: string; province: string; items: Listing[] }>()
      for (const listing of listings) {
        const key = `${listing.city}|${listing.province}`
        const group = groups.get(key) ?? { city: listing.city, province: listing.province, items: [] }
        group.items.push(listing)
        groups.set(key, group)
      }

      // Default marker icon assets don't resolve under Next's bundler — point at CDN copies instead
      const icon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      })

      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
        attributionControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map)

      const coords: [number, number][] = []
      for (const group of groups.values()) {
        const { lat, lng } = getCityCoordinates(group.city, group.province)
        coords.push([lat, lng])

        const rows = group.items
          .slice(0, 5)
          .map((item) => {
            const thumb = item.images[0]
              ? `<img src="${escapeHtml(item.images[0])}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'" />`
              : `<span style="width:40px;height:40px;border-radius:8px;background:#F1F5F9;flex-shrink:0"></span>`
            return `<a href="/listings/${item.id}" style="display:flex;align-items:center;gap:8px;padding:6px 0;text-decoration:none;color:#111827">
              ${thumb}
              <span style="min-width:0">
                <span style="display:block;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${escapeHtml(item.title)}</span>
                <span style="display:block;color:#003049;font-weight:700;font-size:12px">₱${item.daily_price.toLocaleString('en-PH')}/day</span>
              </span>
            </a>`
          })
          .join('')

        const more =
          group.items.length > 5
            ? `<p style="margin:4px 0 0;font-size:11px;color:#6B7280">+${group.items.length - 5} more listings</p>`
            : ''

        const html = `<div style="min-width:220px">
          <p style="margin:0 0 4px;font-weight:700;font-size:13px;color:#111827">${escapeHtml(group.city)}, ${escapeHtml(group.province)}</p>
          ${rows}
          ${more}
        </div>`

        L.marker([lat, lng], { icon }).addTo(map).bindPopup(html, { maxWidth: 280 })
      }

      if (coords.length === 1) {
        map.setView(coords[0], 12)
      } else if (coords.length > 1) {
        map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] })
      } else {
        map.setView([12.8797, 121.774], 5) // Philippines fallback; empty results are guarded upstream
      }

      mapRef.current = map
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [listings])

  return <div ref={containerRef} className="w-full h-[70vh]" />
}
```

Note vs. `PickupMapLeaflet`: no `mapRef.current` init-once guard — the effect re-creates the map when `listings` changes (filter changes while in map mode), and the cleanup tears down the old instance. `scrollWheelZoom: true` deliberately (primary surface, not an inline embed).

- [ ] **Step 2: Create `src/components/search/SearchMap.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import type { Listing } from '@/types'

interface SearchMapProps {
  listings: Listing[]
}

const LeafletMap = dynamic(() => import('./SearchMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[70vh] bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

export function SearchMap({ listings }: SearchMapProps) {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      <LeafletMap listings={listings} />
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -3`
Expected: compiles clean (components are not yet referenced anywhere; this catches type/syntax errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/search/SearchMapLeaflet.tsx src/components/search/SearchMap.tsx
git commit -m "Add SearchMap components for city-grouped search results map"
```

---

### Task 2: List ⇄ Map toggle in SearchResults

**Files:**
- Modify: `src/components/search/SearchResults.tsx`

**Interfaces:**
- Consumes: `SearchMap` from Task 1 (`import { SearchMap } from './SearchMap'`), props `{ listings: Listing[] }`.
- Produces: the complete user-facing feature.

- [ ] **Step 1: Add imports and view state**

In `src/components/search/SearchResults.tsx`, change the lucide import line from:

```typescript
import { SlidersHorizontal } from 'lucide-react'
```

to:

```typescript
import { SlidersHorizontal, LayoutGrid, Map as MapIcon } from 'lucide-react'
```

Add below the existing `FilterSidebar` import:

```typescript
import { SearchMap } from './SearchMap'
```

Add state after `const [sort, setSort] = useState<SortKey>('recommended')`:

```typescript
  const [view, setView] = useState<'list' | 'map'>('list')
```

- [ ] **Step 2: Add the segmented control**

In the results-header `<div className="flex items-center gap-3">` (which wraps the sort `<select>` and the mobile Filters button), insert BEFORE the `<select>`:

```tsx
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'list' ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                List
              </button>
              <button
                onClick={() => setView('map')}
                aria-pressed={view === 'map'}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'map' ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <MapIcon className="w-4 h-4" />
                Map
              </button>
            </div>
```

- [ ] **Step 3: Render the map in map mode**

The results body currently reads:

```tsx
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-5xl mb-4">📷</p>
            <h3 className="text-lg font-bold text-[#111827] mb-2">No listings found</h3>
            <p className="text-sm text-gray-500">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {results.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
```

Change it to:

```tsx
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-5xl mb-4">📷</p>
            <h3 className="text-lg font-bold text-[#111827] mb-2">No listings found</h3>
            <p className="text-sm text-gray-500">Try adjusting your filters or search terms.</p>
          </div>
        ) : view === 'map' ? (
          <SearchMap listings={results} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {results.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
```

The empty state stays shared between views (map never renders with zero listings, matching the spec).

- [ ] **Step 4: Verify build and lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint 2>&1 | grep -c "error" `
Expected: build clean; lint error count unchanged from the repo's pre-existing baseline (44) — no NEW errors in the touched/created files.

- [ ] **Step 5: Commit**

```bash
git add src/components/search/SearchResults.tsx
git commit -m "Add List/Map toggle to search results"
```

---

### Task 3: Verification + docs

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Live browser verification**

With `npm run dev` running, on `http://localhost:3000/search`:
- Toggle to Map: grid is replaced by a ~70vh rounded map, markers for each seeded city (Manila, Cebu, Davao, …).
- Click a marker: popup shows city name + up to 5 listing rows with thumbnail, title, ₱/day; rows navigate to `/listings/<id>`.
- Apply a category filter in map mode: marker set updates.
- Search for something matching one city only: map centers at zoom 12 without errors.
- Toggle back to List: grid returns, sort still works.

(The controller may perform this with browser tooling or delegate to the user; either way, results are recorded before merge.)

- [ ] **Step 2: Update AGENTS.md**

- To Do: remove the line `- [ ] Search results map view — a map of all matching listings on \`/search\`, distinct from the single-listing pickup map already shipped on \`/listings/[id]\` (could reuse the Leaflet setup, just with multiple markers)`.
- Done list: add `- [x] Search results map view: List ⇄ Map toggle on /search, one marker per city (city-level coords, same privacy model as the pickup map), popups with up to 5 listings + links`.
- Pickup-map architecture note: append the sentence: `The search page reuses the same Leaflet/OSM stack via SearchMap/SearchMapLeaflet (src/components/search/) — city-grouped markers over the filtered results, HTML-escaped popup content, same ssr:false dynamic-import rule.`

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "Wire search results map view end-to-end"
```
