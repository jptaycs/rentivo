'use client'

import { useRecentlyViewed } from '@/hooks/useRecentlyViewed'
import { ListingCard } from '@/components/shared/ListingCard'
import { Clock, X } from 'lucide-react'

export function RecentlyViewed() {
  const { items, clearItems } = useRecentlyViewed()

  if (items.length === 0) return null

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-400" />
          <h2 className="text-2xl font-bold text-[#111827]">Recently Viewed</h2>
        </div>
        <button
          onClick={clearItems}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {items.slice(0, 4).map(listing => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </section>
  )
}
