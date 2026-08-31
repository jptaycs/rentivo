import { Suspense } from 'react'
import { CompactSearchBar } from '@/components/search/CompactSearchBar'
import { SearchResults } from '@/components/search/SearchResults'
import { Skeleton } from '@/components/ui/skeleton'
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
          <Suspense>
            <CompactSearchBar />
          </Suspense>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<SearchSkeleton />}>
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

function SearchSkeleton() {
  return (
    <div className="flex gap-6">
      <div className="hidden md:block w-64 shrink-0 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 rounded-lg" />
        ))}
      </div>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden bg-white shadow-sm">
            <Skeleton className="h-48 w-full rounded-none" />
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
