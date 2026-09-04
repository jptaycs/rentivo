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
        zoom: 13,
        scrollWheelZoom: false,
        attributionControl: true,
      })

      L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map)

      // A floating card, not a pin — the map is deliberately approximate for
      // every listing (see the 1km circle below), so a precise-looking pin
      // would misrepresent what's actually known. Title and image URL are
      // host-authored and go straight into innerHTML, so both are escaped.
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
