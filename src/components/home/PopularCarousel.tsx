'use client'

import { useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { MOCK_LISTINGS } from '@/lib/mock-data'

export function PopularCarousel() {
  const ref = useRef<HTMLDivElement>(null)

  function scroll(dir: 'left' | 'right') {
    if (!ref.current) return
    ref.current.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })
  }

  return (
    <section className="py-12 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-[#111827]">Popular Near You</h2>
          <div className="flex gap-2">
            <button
              onClick={() => scroll('left')}
              className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => scroll('right')}
              className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          ref={ref}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {MOCK_LISTINGS.concat(MOCK_LISTINGS).map((listing, i) => (
            <Link
              key={`${listing.id}-${i}`}
              href={`/listings/${listing.id}`}
              className="group snap-start shrink-0 w-56 bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-all duration-200"
            >
              <div className="relative h-36 overflow-hidden">
                <Image
                  src={listing.images[0] ?? '/placeholder-equipment.jpg'}
                  alt={listing.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  sizes="224px"
                />
              </div>
              <div className="p-3">
                <p className="text-[11px] text-gray-400 font-medium">{listing.brand}</p>
                <p className="text-sm font-semibold text-[#111827] line-clamp-1 mt-0.5">
                  {listing.model}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-sm font-bold text-[#2563EB]">
                    ₱{listing.daily_price.toLocaleString()}<span className="text-[10px] font-normal text-gray-400">/day</span>
                  </p>
                  {listing.rating && (
                    <div className="flex items-center gap-0.5 text-[11px] text-gray-500">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {listing.rating}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
