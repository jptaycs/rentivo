'use client'

import { useEffect, useState } from 'react'
import { Heart, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useWishlist } from '@/hooks/useWishlist'
import { useUser } from '@/hooks/useUser'
import { createClient } from '@/lib/supabase/client'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { ListingCard } from '@/components/shared/ListingCard'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'
import type { Listing } from '@/types'

// Explicit column lists, never `*` — see listing-columns.ts (street_address on
// listings, qr_payment_label on profiles must never reach a client payload).
const HOST_SELECT = `${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey(${PROFILE_COLUMNS})`

// Public wishlist page — reachable signed out. A guest's hearts live in
// localStorage (useWishlist/useWishlistStore); a signed-in user's live in
// the `wishlist` table. This page's rendering mirrors what
// dashboard/wishlist/page.tsx used to do (that page now just redirects
// here — see its own comment for why keeping one view matters), but the
// data-source branch below is NOT `live` (signed-in-ness) the way that
// page's was — it's `configured` (whether Supabase exists at all).
//
// The old dashboard page could only ever be reached signed-in (it sat
// behind the /dashboard auth wall), so there `!live` only ever meant "no
// Supabase configured" (mock/dev mode) — mock data was always the right
// fallback. This page can be reached signed OUT on a fully live site,
// where `!live` also covers "Supabase is configured, nobody's signed in"
// — a real guest with real listing ids in localStorage. Branching on
// `live` there would silently look those real ids up in MOCK_LISTINGS
// and find nothing. `listings` RLS already allows anon reads (public
// browsing has always worked signed out — home, search, listing detail),
// so a guest queries the real table exactly like a signed-in user does.
export default function WishlistPage() {
  const { ids, live } = useWishlist()
  const { configured } = useUser()
  const [listings, setListings] = useState<Listing[] | null>(null)

  useEffect(() => {
    if (!configured) {
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
  }, [configured, ids])

  const wishlisted = listings ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-[#111827]">Wishlist</h1>
        {wishlisted.length > 0 && (
          <span className="text-sm text-gray-400">({wishlisted.length} saved)</span>
        )}
      </div>

      {/* Guests keep their hearts on this device only. Say so once, quietly
          — not a banner competing with the grid below it. */}
      {!live && wishlisted.length > 0 && (
        <p className="text-sm text-gray-400">
          Saved on this device.{' '}
          <Link href="/login?next=/wishlist" className="text-[#003049] font-medium hover:underline">
            Sign in
          </Link>{' '}
          to keep your wishlist across devices — items you&apos;ve saved here will move to your account.
        </p>
      )}

      {listings === null ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
        </div>
      ) : wishlisted.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border border-gray-100">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Heart className="w-7 h-7 text-red-400" />
          </div>
          <h3 className="font-bold text-[#111827] mb-2">Your wishlist is empty</h3>
          <p className="text-sm text-gray-400 mb-5">
            Tap the heart on any camera, phone, or lens to save it here for later.
          </p>
          <Link
            href="/search"
            className="bg-[#003049] text-white font-semibold px-6 py-2.5 rounded-xl text-sm hover:bg-[#002438] transition-colors"
          >
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
