/**
 * Single source of truth for the basemap both Leaflet maps render
 * (`PickupMapLeaflet` on listing detail, `SearchMapLeaflet` on /search).
 *
 * These two used to declare their own identical `L.tileLayer(...)` call, which
 * is exactly the duplicate-list shape that has already drifted twice in this
 * repo (the province dropdown vs. the coordinate table in ph-locations.ts, and
 * the brand list before src/lib/brands.ts). One export, imported by both.
 *
 * Esri World Topo, chosen 2026-09-03 over the previous OpenStreetMap "Mapnik"
 * tiles for a cleaner, Google-Terrain-like look: light muted palette, far fewer
 * POI labels, and genuine hillshading. Like OSM it needs no API key, no account
 * and costs nothing — the same constraint that ruled out Mapbox originally.
 *
 * CARTO Positron/Voyager were evaluated first and REJECTED: their keyless tile
 * endpoints still return HTTP 200, but the image itself is stamped with an
 * "API KEY REQUIRED" watermark. A status-code-only check passes them, so do not
 * re-introduce a CARTO URL on the strength of a `curl -I` — look at the pixels.
 *
 * NOTE the `{z}/{y}/{x}` ordering: Esri's ArcGIS REST tile endpoint puts row
 * before column, the reverse of the OSM/XYZ `{z}/{x}/{y}` convention. Swapping
 * them silently serves tiles for the wrong place rather than 404ing.
 *
 * The host here must stay in sync with `img-src` in next.config.ts's CSP, or
 * every tile is blocked and the map renders as empty grey space.
 */

export const MAP_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'

/** Esri's required attribution for the World Topo basemap. */
export const MAP_TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'

/** World Topo publishes tiles up to z19. */
export const MAP_TILE_MAX_ZOOM = 19

export const MAP_TILE_OPTIONS = {
  attribution: MAP_TILE_ATTRIBUTION,
  maxZoom: MAP_TILE_MAX_ZOOM,
}
