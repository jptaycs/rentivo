import { ListingCard } from '@/components/shared/ListingCard'
import { getFeaturedListings, getActiveListingCount } from '@/lib/listings'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export async function FeaturedListings() {
  const [listings, totalCount] = await Promise.all([
    getFeaturedListings(6),
    getActiveListingCount(),
  ])

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-[#111827]">Featured Equipment</h2>
        <Link
          href="/search"
          className="flex items-center gap-1 text-sm font-semibold text-[#003049] hover:text-blue-700 transition-colors"
        >
          View all <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
      <div className="mt-8 text-center">
        <Link
          href="/search"
          className="inline-flex items-center gap-2 border border-gray-200 hover:border-[#003049] text-gray-700 hover:text-[#003049] font-semibold text-sm px-6 py-3 rounded-full transition-all"
        >
          View all {totalCount} listings <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  )
}
