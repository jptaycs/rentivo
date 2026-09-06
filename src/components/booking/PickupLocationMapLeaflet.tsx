'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@/lib/map-tiles'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Next's webpack loader returns StaticImageData (.src); Turbopack's dev loader
// returns the URL string. Handle both, as the other Leaflet components do.
function assetSrc(mod: string | { src: string }): string {
  return typeof mod === 'string' ? mod : mod.src
}

interface Props {
  lat: number
  lng: number
}

/**
 * The renter-facing EXACT pickup point, shown only after a booking is
 * confirmed. Deliberately a separate component from PickupMapLeaflet, which is
 * the PUBLIC map: that one is built around the rounded approx_* coordinates and
 * a 1km circle, and this one is handed a precise point. Keeping them apart
 * means no refactor of the public map can accidentally start rendering an exact
 * coordinate to anonymous visitors — the mistake this codebase has already made
 * twice with street_address and qr_payment_label.
 *
 * The caller is responsible for only ever passing coordinates that came back
 * from get_listing_coordinates(), which is gated on the caller being the host
 * or a renter with a confirmed booking.
 */
export default function PickupLocationMapLeaflet({ lat, lng }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const icon = L.icon({
        iconUrl: assetSrc(markerIconUrl),
        iconRetinaUrl: assetSrc(markerIconRetinaUrl),
        shadowUrl: assetSrc(markerShadowUrl),
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      })

      // Closer zoom than the public map: this is the actual doorstep, so the
      // useful view is the street, not the district.
      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 17,
        scrollWheelZoom: false,
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
  }, [lat, lng])

  return <div ref={containerRef} className="w-full h-56" />
}
