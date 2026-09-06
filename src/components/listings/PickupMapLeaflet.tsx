'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@/lib/map-tiles'
import { getCityCoordinates } from '@/lib/ph-locations'
import { escapeHtml } from '@/lib/html-escape'

interface PickupMapLeafletProps {
  city: string
  province: string
  title: string
  imageUrl?: string
  approxLat?: number | null
  approxLng?: number | null
}

export default function PickupMapLeaflet({
  city, province, title, imageUrl, approxLat, approxLng,
}: PickupMapLeafletProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      // Prefer the host's approximate pin; fall back to the city centre for
      // a listing with no coordinates yet (pre-066 backfill, or mock data).
      const { lat, lng } = approxLat != null && approxLng != null
        ? { lat: approxLat, lng: approxLng }
        : getCityCoordinates(city, province)

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        // Zoom follows the circle: at 3dp the approximate area is only 150m
        // across, which at the old district zoom rendered as a ~16px dot and
        // read as a precise pin rather than an area. Zoom 16 makes the circle
        // legible as the area it represents.
        zoom: 16,
        scrollWheelZoom: false,
        attributionControl: true,
      })

      L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map)

      // A floating card, not a pin — the map is deliberately approximate for
      // every listing (see the 150m circle below), so a precise-looking pin
      // would misrepresent what's actually known. Title and image URL are
      // host-authored and go straight into innerHTML, so both are escaped.
      //
      // iconSize is deliberately omitted (not [0, 0]) — Leaflet only sets an
      // inline width/height on the marker container when iconSize is given
      // (see DivIcon's own "also can be set through CSS" comment). Passing
      // [0, 0] forces a zero-width container, and the card's flex child then
      // collapses to match instead of sizing to its content. Leaving iconSize
      // unset lets the (absolutely-positioned, width:auto) marker container
      // shrink-wrap to the card's real content width. iconAnchor sits the
      // marker at the card's left edge, vertically centered on the ~48px-tall
      // row (36px thumbnail + 6px top/bottom padding), so the card floats
      // just beside the actual coordinate rather than far from it.
      const card = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:12px;
            box-shadow:0 4px 14px rgba(0,0,0,.18);padding:6px 10px 6px 6px;white-space:nowrap;width:max-content">
            ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0"
              onerror="this.style.display='none'" />` : ''}
            <span style="font-weight:600;font-size:12px;color:#111827;max-width:180px;overflow:hidden;
              text-overflow:ellipsis">${escapeHtml(title)}</span>
          </div>`,
        iconSize: undefined,
        iconAnchor: [0, 24],
      })
      L.marker([lat, lng], { icon: card }).addTo(map)
      L.circle([lat, lng], { radius: 150, color: '#003049', weight: 1, fillOpacity: 0.08 }).addTo(map)

      mapRef.current = map
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [city, province, title, imageUrl, approxLat, approxLng])

  return <div ref={containerRef} className="w-full h-56" />
}
