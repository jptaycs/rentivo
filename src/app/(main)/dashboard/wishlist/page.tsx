'use client'

import { Heart } from 'lucide-react'
import Link from 'next/link'
import { useWishlistStore } from '@/store/wishlist'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { ListingCard } from '@/components/shared/ListingCard'

export default function WishlistPage() {
  const ids = useWishlistStore(s => s.ids)
  const wishlisted = MOCK_LISTINGS.filter(l => ids.includes(l.id))

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-[#111827]">Wishlist</h1>
        {wishlisted.length > 0 && (
          <span className="text-sm text-gray-400">({wishlisted.length} saved)</span>
        )}
      </div>

      {wishlisted.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border border-gray-100">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Heart className="w-7 h-7 text-red-400" />
          </div>
          <h3 className="font-bold text-[#111827] mb-2">No saved listings yet</h3>
          <p className="text-sm text-gray-400 mb-5">Tap the heart on any listing to save it here.</p>
          <Link href="/search" className="bg-[#2563EB] text-white font-semibold px-6 py-2.5 rounded-xl text-sm hover:bg-blue-700 transition-colors">
            Browse Equipment
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {wishlisted.map(listing => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
