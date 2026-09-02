'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@/lib/map-tiles'
import { getCityCoordinates } from '@/lib/ph-locations'
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

interface PickupMapLeafletProps {
  city: string
  province: string
}

export default function PickupMapLeaflet({ city, province }: PickupMapLeafletProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const { lat, lng } = getCityCoordinates(city, province)

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
        center: [lat, lng],
        zoom: 13,
        scrollWheelZoom: false,
        attributionControl: true,
      })

      L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map)

      L.marker([lat, lng], { icon }).addTo(map)

      mapRef.current = map
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [city, province])

  return <div ref={containerRef} className="w-full h-56" />
}
