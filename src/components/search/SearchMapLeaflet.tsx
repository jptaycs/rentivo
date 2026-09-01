'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { getCityCoordinates } from '@/lib/ph-locations'
import type { Listing } from '@/types'
// Bundled locally so the marker serves from 'self' — next.config.ts's CSP
// img-src does not (and should not) allow unpkg.com; these are Next
// static-asset imports (resolve to hashed URLs under /_next/static/media).
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Next's webpack image loader returns a `StaticImageData` object (`.src`);
// Turbopack's dev-mode loader for a plain (non-`next/image`) import instead
// returns the resolved URL string directly. Handle both so the bundled
// marker works identically under `next dev` and `next build`.
function assetSrc(mod: string | { src: string }): string {
  return typeof mod === 'string' ? mod : mod.src
}

interface SearchMapLeafletProps {
  listings: Listing[]
}

// Escapes for text content and double-quoted attributes — all generated HTML attributes must stay double-quoted
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

      // Default marker icon assets don't resolve under Next's bundler as
      // Leaflet ships them — import them as Next static assets instead so
      // they're bundled and served from 'self' (the CSP doesn't, and
      // shouldn't, allow a marker-image CDN).
      const icon = L.icon({
        iconUrl: assetSrc(markerIconUrl),
        iconRetinaUrl: assetSrc(markerIconRetinaUrl),
        shadowUrl: assetSrc(markerShadowUrl),
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
            return `<a href="/listings/${escapeHtml(item.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 0;text-decoration:none;color:#111827">
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
