'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
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
    </div>
  )
}
