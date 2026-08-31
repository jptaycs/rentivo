'use client'

import { useEffect, useState } from 'react'
import { Heart, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useWishlist } from '@/hooks/useWishlist'
import { createClient } from '@/lib/supabase/client'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { ListingCard } from '@/components/shared/ListingCard'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'
import type { Listing } from '@/types'

// Explicit column lists, never `*` — see listing-columns.ts (street_address on
// listings, qr_payment_label on profiles must never reach a client payload).
const HOST_SELECT = `${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey(${PROFILE_COLUMNS})`

export default function WishlistPage() {
  const { ids, live } = useWishlist()
  const [listings, setListings] = useState<Listing[] | null>(null)

  useEffect(() => {
    if (!live) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guest bailout; no test suite to safely verify a rewrite (see AGENTS.md)
      setListings(MOCK_LISTINGS.filter((l) => ids.includes(l.id)))
      return
    }
    if (ids.length === 0) {
      setListings([])
      return
    }
    const supabase = createClient()
    supabase
      .from('listings')
      .select(HOST_SELECT)
      .in('id', ids)
      .eq('is_active', true)
      .then(({ data }) => setListings((data as unknown as Listing[]) ?? []))
  }, [live, ids])

  const wishlisted = listings ?? []

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-[#111827]">Wishlist</h1>
        {wishlisted.length > 0 && (
          <span className="text-sm text-gray-400">({wishlisted.length} saved)</span>
        )}
      </div>

      {listings === null ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
        </div>
      ) : wishlisted.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border border-gray-100">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Heart className="w-7 h-7 text-red-400" />
          </div>
          <h3 className="font-bold text-[#111827] mb-2">No saved listings yet</h3>
          <p className="text-sm text-gray-400 mb-5">Tap the heart on any listing to save it here.</p>
          <Link href="/search" className="bg-[#003049] text-white font-semibold px-6 py-2.5 rounded-xl text-sm hover:bg-[#002438] transition-colors">
            Browse Equipment
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {wishlisted.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  )
}
