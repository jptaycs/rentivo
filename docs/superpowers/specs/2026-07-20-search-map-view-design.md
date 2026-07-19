# Search Results Map View — Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Let renters see search results on a map: a List ⇄ Map toggle on `/search` showing one marker per city with the matching listings in a popup. Complements the single-listing pickup map already shipped on `/listings/[id]`.

## Decisions (made with user)

- **Layout:** List ⇄ Map toggle beside the sort dropdown — map replaces the card grid when active. No split view, no banner.
- **Component strategy:** new `SearchMap` / `SearchMapLeaflet` pair in `src/components/search/`, mirroring the shipped `PickupMap` pattern. `PickupMapLeaflet` is NOT refactored or touched — the two use cases differ enough (single fixed pin vs. grouped markers + fitBounds + popups) that sharing would be premature abstraction against verified code.
- **Grouping:** listings only expose city-level coordinates (privacy design from the pickup map), so listings in the same city share one marker. One marker per `city|province` group; never one overlapping pin per listing.

## Components

### `src/components/search/SearchMap.tsx` (client wrapper)

Mirrors `PickupMap.tsx`: `next/dynamic` import of `SearchMapLeaflet` with `ssr: false` (Leaflet touches `window`) and a gray placeholder while loading. Props: `{ listings: Listing[] }`. Never import `SearchMapLeaflet` directly into a Server Component; never drop the `ssr:false` guard.

### `src/components/search/SearchMapLeaflet.tsx`

Default-exported client component, structure copied from `PickupMapLeaflet.tsx` (dynamic `import('leaflet')`, CDN marker icons, OSM tile layer, cleanup on unmount).

- Group `listings` by `${city}|${province}`; resolve each group via `getCityCoordinates(city, province)` from `src/lib/ph-locations.ts`.
- One `L.marker` per group. Popup content (built as an HTML string, since Leaflet popups are not React trees):
  - City name header.
  - Up to 5 rows per city: 40px thumbnail (first listing image, plain `<img>`), title, `₱X,XXX/day` — each row an `<a href="/listings/<id>">`.
  - `+N more listings` plain-text line when a group exceeds 5.
  - All text content HTML-escaped before interpolation (titles are user-authored).
- Bounds: `map.fitBounds` over all group coordinates with `padding: [40, 40]`; if exactly one group, `setView(coords, 12)` instead.
- Container: `w-full h-[70vh] rounded-2xl` (map mode replaces the grid, keeps design-system rounding).
- `scrollWheelZoom: true` here (unlike the pickup map) — it's the primary surface in map mode, not an inline embed.

### `SearchResults.tsx` changes

- New state `view: 'list' | 'map'` (default `'list'`).
- Segmented List | Map control next to the sort dropdown (List/Map icons from lucide: `LayoutGrid`, `Map`), active segment `bg-[#003049] text-white`.
- Map mode renders `<SearchMap listings={results} />` in place of the card grid — `results` is the already-filtered/sorted array, so the map always reflects current filters. The results-count header and sort dropdown remain visible (sort has no visual effect on the map; that's fine).
- Empty results: keep the existing empty state in both views (toggle still works; map never renders with zero listings).

## Data flow

Server component (`/search/page.tsx`) already fetches listings with `LISTING_COLUMNS` (city/province included, no street_address) → `SearchResults` filters/sorts client-side → map mode groups by city → markers/popups. No new queries, no new data exposure: everything rendered is already public on the cards.

## Error handling

- Unknown city (not in `ph-locations.ts`): `getCityCoordinates` already falls back to its default (Manila) — same behavior as the pickup map. Acceptable; the static table covers all seeded/wizard cities.
- Listings with no photos: thumbnail `<img>` falls back to a gray box (`onerror` hides the img; wrapper div has a bg).
- Mock-data mode: works identically — mock listings have city/province.

## Testing

1. `npm run build` + `npm run lint` (no new lint issues; repo has pre-existing ones).
2. Live on `/search`: toggle swaps grid ⇄ map; markers appear for each distinct city in seeded data (Manila, Cebu, Davao, etc.); popup rows link to the right listing pages; filtering (e.g. category) updates the marker set; single-city result centers without fitBounds errors; mobile viewport renders the toggle and map usably.
