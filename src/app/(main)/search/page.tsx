import { Suspense } from 'react'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchResults } from '@/components/search/SearchResults'
import { SearchPageSkeleton } from '@/components/shared/Skeletons'
import { searchListings, type ListingSearchParams } from '@/lib/listings'

interface SearchPageProps {
  searchParams: Promise<{
    q?: string
    category?: string
    brand?: string
    city?: string
    from?: string
    to?: string
    min_price?: string
    max_price?: string
    instant_book?: string
    verified?: string
    min_rating?: string
  }>
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Sticky search bar */}
      <div className="sticky top-16 z-40 bg-[#F8FAFC] border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <SearchBar
            variant="compact"
            initialQuery={params.q ?? ''}
            initialCity={params.city ?? ''}
            initialFrom={params.from}
            initialTo={params.to}
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<SearchPageSkeleton />}>
          <SearchResultsLoader
            query={params.q ?? ''}
            category={params.category ?? ''}
            brand={params.brand ?? ''}
            city={params.city ?? ''}
            minPrice={Number(params.min_price ?? 0)}
            maxPrice={Number(params.max_price ?? 99999)}
            instantBook={params.instant_book === '1'}
            verified={params.verified === '1'}
            minRating={Number(params.min_rating ?? 0)}
            from={params.from}
            to={params.to}
          />
        </Suspense>
      </div>
    </div>
  )
}

async function SearchResultsLoader(props: ListingSearchParams & { query: string }) {
  const listings = await searchListings(props)
  return <SearchResults query={props.query} listings={listings} />
}
