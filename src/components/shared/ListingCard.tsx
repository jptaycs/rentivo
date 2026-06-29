'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Heart, Star, Zap, BadgeCheck } from 'lucide-react'
import { useWishlistStore } from '@/store/wishlist'
import type { Listing } from '@/types'

interface ListingCardProps {
  listing: Listing
}

export function ListingCard({ listing }: ListingCardProps) {
  const toggle = useWishlistStore((s) => s.toggle)
  const isWishlisted = useWishlistStore((s) => s.has(listing.id))

  return (
    <div className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
      {/* Image */}
      <Link href={`/listings/${listing.id}`} className="block relative aspect-[4/3] overflow-hidden">
        <Image
          src={listing.images[0] ?? '/placeholder-equipment.jpg'}
          alt={listing.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />

        {/* Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Verified badge */}
        {listing.host?.is_verified && (
          <div className="absolute top-3 left-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm text-[#2563EB] text-xs font-semibold px-2 py-1 rounded-full">
            <BadgeCheck className="w-3 h-3" />
            Verified
          </div>
        )}

        {/* Instant Book badge */}
        {listing.is_instant_book && (
          <div className="absolute top-3 right-10 flex items-center gap-1 bg-[#F97316] text-white text-xs font-semibold px-2 py-1 rounded-full">
            <Zap className="w-3 h-3" />
            Instant
          </div>
        )}
      </Link>

      {/* Wishlist button */}
      <button
        onClick={() => toggle(listing.id)}
        className="absolute top-3 right-3 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-sm hover:scale-110 transition-transform"
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        <Heart
          className={`w-4 h-4 transition-colors ${isWishlisted ? 'fill-red-500 text-red-500' : 'text-gray-500'}`}
        />
      </button>

      {/* Info */}
      <Link href={`/listings/${listing.id}`} className="block p-4">
        <p className="text-xs text-gray-500 font-medium mb-0.5">{listing.brand}</p>
        <h3 className="font-semibold text-[#111827] text-sm leading-snug line-clamp-2 mb-1">
          {listing.title}
        </h3>
        <p className="text-xs text-gray-400 mb-3">{listing.city}</p>

        <div className="flex items-center justify-between">
          <p className="font-bold text-[#111827]">
            <span className="text-[#2563EB]">₱{listing.daily_price.toLocaleString()}</span>
            <span className="text-xs font-normal text-gray-500">/day</span>
          </p>

          {listing.rating != null && (
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="font-semibold">{listing.rating.toFixed(2)}</span>
              {listing.review_count > 0 && (
                <span className="text-gray-400">({listing.review_count})</span>
              )}
            </div>
          )}
        </div>
      </Link>
    </div>
  )
}
