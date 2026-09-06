'use client'

import dynamic from 'next/dynamic'
import { MapPin, Loader2 } from 'lucide-react'

// Leaflet touches window, so it never renders on the server.
const LeafletMap = dynamic(() => import('./PickupLocationMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-56 bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

interface Props {
  lat: number
  lng: number
  city: string
  province: string
  /** The host's typed street address. Optional — most listings have none. */
  address?: string | null
}

/** The exact pickup point, shown to a renter once their booking is confirmed. */
export function PickupLocationMap({ lat, lng, city, province, address }: Props) {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      <LeafletMap lat={lat} lng={lng} />
      <div className="flex items-start gap-2 px-4 py-3 border-t border-gray-100">
        <MapPin className="w-4 h-4 text-[#003049] shrink-0 mt-0.5" />
        <div className="text-sm text-gray-600">
          {address && <p className="font-semibold text-[#111827]">{address}</p>}
          <p className={address ? 'mt-0.5' : undefined}>
            {!address && <span className="font-semibold text-[#111827]">{city}, {province}</span>}
            {!address && ' — '}
            {address ? `${city}, ${province}` : 'exact pickup point, shared because your booking is confirmed.'}
          </p>
          {address && (
            <p className="mt-1 text-xs text-gray-400">
              Shared because your booking is confirmed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
