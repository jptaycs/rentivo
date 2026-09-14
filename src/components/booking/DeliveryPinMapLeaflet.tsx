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
 * The RENTER's delivery pin, shown to the host of a paid delivery booking so
 * they can check it against the typed address before accepting. This plots
 * only `bookings.delivery_latitude/longitude` — never a listing coordinate.
 * Kept apart from PickupLocationMapLeaflet (the listing's exact pickup point,
 * gated by get_listing_coordinates) so neither can be repurposed for the other.
 */
export default function DeliveryPinMapLeaflet({ lat, lng }: Props) {
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

      // Street-level: the host is comparing the pin with a written address.
      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 16,
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

  return <div ref={containerRef} className="w-full h-[220px]" data-testid="delivery-pin-map" />
}
