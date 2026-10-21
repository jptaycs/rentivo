import type { Metadata } from 'next'
import { Suspense } from 'react'
import { categoryLabel, categoryNoun } from '@/lib/categories'
import { SITE_URL } from '@/lib/site'
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

// Title and description follow the category/city filters so a shared or
// indexed search URL reads as a page about that thing ("Mirrorless camera
// rentals in Cebu City"), not as a generic search. The canonical keeps only
// category and city: dates, prices and toggles are the same page to a crawler.
export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams
  const category = params.category ?? ''
  const city = (params.city ?? '').trim()
  const q = (params.q ?? '').trim()

  const label = categoryLabel(category)
  const noun = categoryNoun(category)
  const where = city ? ` in ${city}` : ' in the Philippines'
  const title = noun
    ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} rentals${where}`
    : q
      ? `"${q}" for rent${where}`
      : `Camera, lens and smartphone rentals${where}`
  const description = label
    ? `Rent a ${noun}${where} from verified owners on Rentivo. Daily, weekly and monthly rates, secure online payment, local pickup.`
    : `Find cameras, lenses and smartphones for rent${where}. Verified hosts, secure online payment, pick up locally.`

  const canonical = new URL('/search', SITE_URL)
  if (label) canonical.searchParams.set('category', category)
  if (city) canonical.searchParams.set('city', city)

  return {
    title,
    description,
    alternates: { canonical: canonical.toString() },
    openGraph: { title, description, url: canonical.toString() },
    // A free-text query is a user's search, not a page worth indexing.
    robots: q && !label && !city ? { index: false, follow: true } : undefined,
  }
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
