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

export function SearchResults(props: SearchResultsProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const results = applyFilters(MOCK_LISTINGS, props)

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
            <select className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 outline-none focus:border-[#003049]">
              <option>Sort: Recommended</option>
              <option>Price: Low to High</option>
              <option>Price: High to Low</option>
              <option>Highest Rated</option>
              <option>Newest</option>
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
