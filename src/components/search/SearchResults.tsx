'use client'

import { ListingCard } from '@/components/shared/ListingCard'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { FilterSidebar } from './FilterSidebar'
import type { Listing } from '@/types'
import type { EquipmentCategory } from '@/types'

interface SearchResultsProps {
  query: string
  category: string
  brand: string
  minPrice: number
  maxPrice: number
  instantBook: boolean
  verified: boolean
  minRating: number
}

function applyFilters(listings: Listing[], filters: SearchResultsProps): Listing[] {
  return listings.filter((l) => {
    if (filters.query) {
      const q = filters.query.toLowerCase()
      if (
        !l.title.toLowerCase().includes(q) &&
        !l.brand.toLowerCase().includes(q) &&
        !l.model.toLowerCase().includes(q)
      ) return false
    }
    if (filters.category && l.category !== filters.category) return false
    if (filters.brand && l.brand !== filters.brand) return false
    if (l.daily_price < filters.minPrice || l.daily_price > filters.maxPrice) return false
    if (filters.instantBook && !l.is_instant_book) return false
    if (filters.verified && !l.host?.is_verified) return false
    if (filters.minRating && (l.rating ?? 0) < filters.minRating) return false
    return true
  })
}

type SortKey = 'recommended' | 'price_asc' | 'price_desc' | 'rating' | 'newest'

function sortListings(listings: Listing[], sort: SortKey): Listing[] {
  const copy = [...listings]
  switch (sort) {
    case 'price_asc':  return copy.sort((a, b) => a.daily_price - b.daily_price)
    case 'price_desc': return copy.sort((a, b) => b.daily_price - a.daily_price)
    case 'rating':     return copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    case 'newest':     return copy.sort((a, b) => b.created_at.localeCompare(a.created_at))
    default:           return copy
  }
}

export function SearchResults(props: SearchResultsProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [sort, setSort] = useState<SortKey>('recommended')

  const results = sortListings(applyFilters(MOCK_LISTINGS, props), sort)

  return (
    <div className="flex gap-6 items-start">
      {/* Sidebar — desktop */}
      <div className="hidden md:block w-64 shrink-0 sticky top-20">
        <FilterSidebar />
      </div>

      {/* Mobile filter drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-white overflow-y-auto p-4">
            <FilterSidebar onClose={() => setMobileFiltersOpen(false)} />
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 min-w-0">
        {/* Results header */}
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-[#111827]">{results.length}</span> listings found
            {props.query && <span> for "<span className="text-[#003049]">{props.query}</span>"</span>}
          </p>
          <div className="flex items-center gap-3">
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 outline-none focus:border-[#003049] cursor-pointer"
            >
              <option value="recommended">Sort: Recommended</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
              <option value="newest">Newest</option>
            </select>
            <button
              onClick={() => setMobileFiltersOpen(true)}
              className="md:hidden flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
            </button>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-5xl mb-4">📷</p>
            <h3 className="text-lg font-bold text-[#111827] mb-2">No listings found</h3>
            <p className="text-sm text-gray-500">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {results.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
