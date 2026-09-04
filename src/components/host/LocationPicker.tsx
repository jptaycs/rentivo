'use client'

import dynamic from 'next/dynamic'
import { MapPin, Loader2 } from 'lucide-react'

const Picker = dynamic(() => import('./LocationPickerLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

interface Props {
  city: string
  province: string
  value: { lat: number; lng: number } | null
  onChange: (c: { lat: number; lng: number }) => void
}

export function LocationPicker({ city, province, value, onChange }: Props) {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
      {/* Remount when the city changes so the map re-centres there. */}
      <Picker key={`${province}|${city}`} city={city} province={province} value={value} onChange={onChange} />
      <div className="flex items-start gap-2 px-4 py-3 border-t border-gray-100">
        <MapPin className="w-4 h-4 text-[#003049] shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600">
          {value
            ? 'Pickup point set. Drag the pin or tap the map to adjust.'
            : 'Tap the map to mark exactly where renters collect the gear.'}
          {' '}Renters see an approximate area until a booking is confirmed.
        </p>
      </div>
    </div>
  )
}
