'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_OPTIONS } from '@/lib/map-tiles'
import { getCityCoordinates } from '@/lib/ph-locations'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Next's webpack loader returns StaticImageData (.src); Turbopack's dev loader
// returns the URL string. Handle both, exactly as PickupMapLeaflet does.
function assetSrc(mod: string | { src: string }): string {
  return typeof mod === 'string' ? mod : mod.src
}

interface Props {
  city: string
  province: string
  value: { lat: number; lng: number } | null
  onChange: (c: { lat: number; lng: number }) => void
}

export default function LocationPickerLeaflet({ city, province, value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  // onChange changes identity every render; keep it in a ref so the map is
  // built once and the handler always calls the latest one.
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const start = value ?? getCityCoordinates(city, province)
      const icon = L.icon({
        iconUrl: assetSrc(markerIconUrl),
        iconRetinaUrl: assetSrc(markerIconRetinaUrl),
        shadowUrl: assetSrc(markerShadowUrl),
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      })

      const map = L.map(containerRef.current, {
        center: [start.lat, start.lng],
        zoom: value ? 16 : 13,
        scrollWheelZoom: false,
      })
      L.tileLayer(MAP_TILE_URL, MAP_TILE_OPTIONS).addTo(map)

      const marker = L.marker([start.lat, start.lng], { icon, draggable: true }).addTo(map)
      const emit = (lat: number, lng: number) => onChangeRef.current({ lat, lng })

      marker.on('dragend', () => {
        const p = marker.getLatLng()
        emit(p.lat, p.lng)
      })
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        marker.setLatLng(e.latlng)
        emit(e.latlng.lat, e.latlng.lng)
      })

      mapRef.current = map
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Built once. Re-centring on a city change is handled by the wrapper's key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="w-full h-64" />
}
