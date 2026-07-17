import { MapPin } from 'lucide-react'
import { getCityCoordinates } from '@/lib/ph-locations'

interface PickupMapProps {
  city: string
  province: string
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

export function PickupMap({ city, province }: PickupMapProps) {
  const { lat, lng } = getCityCoordinates(city, province)

  const mapUrl = MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+003049(${lng},${lat})/${lng},${lat},12,0/800x360@2x?access_token=${MAPBOX_TOKEN}`
    : null

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      {mapUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Mapbox Static Images API, not a project asset
        <img
          src={mapUrl}
          alt={`Approximate pickup area in ${city}, ${province}`}
          className="w-full h-56 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-56 bg-[#F8FAFC] flex items-center justify-center">
          <MapPin className="w-8 h-8 text-gray-300" />
        </div>
      )}
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
