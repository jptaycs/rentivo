// Escapes for text content and double-quoted attributes — all generated HTML
// attributes built from this must stay double-quoted. Shared by every Leaflet
// `divIcon`/popup that injects host- or user-authored text (listing titles,
// image URLs, city/province names) via `innerHTML` — those strings are never
// safe to interpolate raw.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
