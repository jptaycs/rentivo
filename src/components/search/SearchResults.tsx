'use client'

import { ListingCard } from '@/components/shared/ListingCard'
import { SlidersHorizontal, LayoutGrid, Map as MapIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FilterSidebar } from './FilterSidebar'
import { SearchMap } from './SearchMap'
import type { Listing } from '@/types'

interface SearchResultsProps {
  query: string
  listings: Listing[]
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

export function SearchResults({ query, listings }: SearchResultsProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [sort, setSort] = useState<SortKey>('recommended')
  const [view, setView] = useState<'list' | 'map'>('list')

  const results = useMemo(() => sortListings(listings, sort), [listings, sort])

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
            {query && <span> for &quot;<span className="text-[#003049]">{query}</span>&quot;</span>}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'list' ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                List
              </button>
              <button
                type="button"
                onClick={() => setView('map')}
                aria-pressed={view === 'map'}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'map' ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <MapIcon className="w-4 h-4" />
                Map
              </button>
            </div>
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
        ) : view === 'map' ? (
          <SearchMap listings={results} />
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
