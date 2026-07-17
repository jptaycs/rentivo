'use client'

import dynamic from 'next/dynamic'
import { MapPin, Loader2 } from 'lucide-react'

interface PickupMapProps {
  city: string
  province: string
}

const LeafletMap = dynamic(() => import('./PickupMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-56 bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

export function PickupMap({ city, province }: PickupMapProps) {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      <LeafletMap city={city} province={province} />
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100">
        <MapPin className="w-4 h-4 text-[#003049] shrink-0" />
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-[#111827]">{city}, {province}</span>
          {' — '}exact pickup address is shared after your booking is confirmed.
        </p>
      </div>
    </div>
  )
}
