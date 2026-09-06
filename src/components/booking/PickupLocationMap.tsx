'use client'

import dynamic from 'next/dynamic'
import { MapPin, Loader2, Navigation } from 'lucide-react'

// Leaflet touches window, so it never renders on the server.
const LeafletMap = dynamic(() => import('./PickupLocationMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[360px] bg-[#F8FAFC] flex items-center justify-center">
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
      {/* Directions are offered ONLY here, never on the public listing map: that
          one plots a deliberately rounded ~150m point, so routing someone to it
          turn-by-turn would send them somewhere the gear isn't and would hand
          out an approximate location as if it were exact. Here we have the
          host's real point, shared because the booking is confirmed.
          Both links are shown rather than sniffing the user agent — each opens
          the native app on its own platform and the web map elsewhere. */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#003049] border border-blue-200 hover:bg-blue-50 px-3 py-2 rounded-xl transition-colors"
        >
          <Navigation className="w-3.5 h-3.5" /> Google Maps
        </a>
        <a
          href={`https://maps.apple.com/?daddr=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#003049] border border-blue-200 hover:bg-blue-50 px-3 py-2 rounded-xl transition-colors"
        >
          <Navigation className="w-3.5 h-3.5" /> Apple Maps
        </a>
      </div>

      <div className="flex items-start gap-2 px-4 py-3 border-t border-gray-100 mt-3">
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
