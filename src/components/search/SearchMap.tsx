'use client'

import dynamic from 'next/dynamic'
import { Loader2, MapPin } from 'lucide-react'
import type { Listing } from '@/types'

interface SearchMapProps {
  listings: Listing[]
}

const LeafletMap = dynamic(() => import('./SearchMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[70vh] bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

export function SearchMap({ listings }: SearchMapProps) {
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
      <LeafletMap listings={listings} />
      {/* No per-card 1km circle here (23 of them would be visual noise, unlike
          the single one on the listing-detail map) — a caption carries the
          same "approximate" disclosure PickupMap.tsx gives a single listing. */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100">
        <MapPin className="w-4 h-4 text-[#003049] shrink-0" />
        <p className="text-sm text-gray-600">
          Pins show an <span className="font-semibold text-[#111827]">approximate area</span>. The exact pickup point is shared once a booking is confirmed.
        </p>
      </div>
    </div>
  )
}
