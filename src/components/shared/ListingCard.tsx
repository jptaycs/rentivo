'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Heart, Star, Zap, BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWishlistStore } from '@/store/wishlist'
import { useState } from 'react'
import type { Listing } from '@/types'

interface ListingCardProps {
  listing: Listing
}

export function ListingCard({ listing }: ListingCardProps) {
  const toggle = useWishlistStore((s) => s.toggle)
  const isWishlisted = useWishlistStore((s) => s.has(listing.id))
  const [imgIdx, setImgIdx] = useState(0)
  const [hovered, setHovered] = useState(false)

  const images = listing.images.length > 0 ? listing.images : ['/placeholder-equipment.jpg']
  const hasMultiple = images.length > 1

  function prev(e: React.MouseEvent) {
    e.preventDefault()
    setImgIdx(i => (i - 1 + images.length) % images.length)
  }
  function next(e: React.MouseEvent) {
    e.preventDefault()
    setImgIdx(i => (i + 1) % images.length)
  }

  return (
    <div
      className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Image carousel */}
      <Link href={`/listings/${listing.id}`} className="block relative aspect-[4/3] overflow-hidden">
        {images.map((src, i) => (
          <Image
            key={i}
            src={src}
            alt={listing.title}
            fill
            className={`object-cover transition-all duration-500 ${
              i === imgIdx ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
            } ${i === imgIdx && hovered ? 'scale-105' : ''}`}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            priority={i === 0}
          />
        ))}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Prev / Next arrows */}
        {hasMultiple && hovered && (
          <>
            <button
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/90 hover:bg-white backdrop-blur-sm rounded-full flex items-center justify-center shadow-md transition-all z-10"
            >
              <ChevronLeft className="w-4 h-4 text-gray-700" />
            </button>
            <button
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/90 hover:bg-white backdrop-blur-sm rounded-full flex items-center justify-center shadow-md transition-all z-10"
            >
              <ChevronRight className="w-4 h-4 text-gray-700" />
            </button>
          </>
        )}

        {/* Dot indicators */}
        {hasMultiple && (
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={e => { e.preventDefault(); setImgIdx(i) }}
                className={`rounded-full transition-all ${
                  i === imgIdx ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/60'
                }`}
              />
            ))}
          </div>
        )}

        {/* Verified badge */}
        {listing.host?.is_verified && (
          <div className="absolute top-3 left-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm text-[#003049] text-xs font-semibold px-2 py-1 rounded-full">
            <BadgeCheck className="w-3 h-3" />
            Verified
          </div>
        )}

        {/* Instant Book badge */}
        {listing.is_instant_book && (
          <div className="absolute top-3 right-10 flex items-center gap-1 bg-[#003049] text-white text-xs font-semibold px-2 py-1 rounded-full">
            <Zap className="w-3 h-3" />
            Instant
          </div>
        )}
      </Link>

      {/* Wishlist button */}
      <button
        onClick={() => toggle(listing.id)}
        className="absolute top-3 right-3 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-sm hover:scale-110 transition-transform z-10"
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        <Heart className={`w-4 h-4 transition-colors ${isWishlisted ? 'fill-red-500 text-red-500' : 'text-gray-500'}`} />
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
            <span className="text-[#003049]">₱{listing.daily_price.toLocaleString()}</span>
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
