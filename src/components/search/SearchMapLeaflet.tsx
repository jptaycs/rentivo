'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@/lib/map-tiles'
import { getCityCoordinates } from '@/lib/ph-locations'
import { escapeHtml } from '@/lib/html-escape'
import type { Listing } from '@/types'

interface SearchMapLeafletProps {
  listings: Listing[]
}

export default function SearchMapLeaflet({ listings }: SearchMapLeafletProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
        attributionControl: true,
      })

      L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map)

      // One floating card per listing, at its approximate pickup point —
      // falling back to the city centre for a listing with no coordinates
      // yet (pre-065 backfill, or mock data). Deliberately no collision
      // handling or clustering: cards will overlap where listings cluster
      // (mostly Metro Manila) — that's an accepted product decision, not a
      // gap. The mouseover/mouseout z-index bump below is legibility only,
      // keeping an overlapped card clickable, not de-collision.
      const coords: [number, number][] = []
      for (const item of listings) {
        const { lat, lng } =
          item.approx_latitude != null && item.approx_longitude != null
            ? { lat: item.approx_latitude, lng: item.approx_longitude }
            : getCityCoordinates(item.city, item.province)
        coords.push([lat, lng])

        // Same card markup/styling as PickupMapLeaflet.tsx's listing-detail
        // pin, plus the price and a link wrapper. Title and image URL are
        // host-authored and go straight into innerHTML, so both are
        // escaped — as is the listing id used in the href.
        //
        // iconSize is deliberately omitted (see PickupMapLeaflet.tsx's
        // comment on the same pattern) so the marker container shrink-wraps
        // to the card's real content width instead of forcing it to 0 and
        // collapsing the flex child. iconAnchor keeps the marker at the
        // card's left edge, vertically centered on its ~56px-tall row.
        const thumb = item.images[0]
          ? `<img src="${escapeHtml(item.images[0])}" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0"
              onerror="this.style.display='none'" />`
          : ''
        const html = `<a href="/listings/${escapeHtml(item.id)}" style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:12px;
            box-shadow:0 4px 14px rgba(0,0,0,.18);padding:6px 10px 6px 6px;white-space:nowrap;text-decoration:none;color:#111827;width:max-content">
            ${thumb}
            <span style="min-width:0">
              <span style="display:block;font-weight:600;font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</span>
              <span style="display:block;color:#003049;font-weight:700;font-size:12px">₱${item.daily_price.toLocaleString('en-PH')}/day</span>
            </span>
          </a>`

        const card = L.divIcon({
          className: '',
          html,
          iconSize: undefined,
          iconAnchor: [0, 28],
        })

        const marker = L.marker([lat, lng], { icon: card }).addTo(map)
        marker.on('mouseover', () => marker.setZIndexOffset(1000))
        marker.on('mouseout', () => marker.setZIndexOffset(0))
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
