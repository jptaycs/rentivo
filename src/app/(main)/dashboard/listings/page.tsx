import Image from 'next/image'
import Link from 'next/link'
import { Plus, Star, Zap, Eye, Pencil, Pause, BadgeCheck } from 'lucide-react'
import { MOCK_LISTINGS } from '@/lib/mock-data'

export default function ListingsPage() {
  const listings = MOCK_LISTINGS.slice(0, 4)

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">My Listings</h1>
          <p className="text-gray-500 text-sm mt-0.5">{listings.length} active listings</p>
        </div>
        <Link
          href="/host/new"
          className="bg-[#2563EB] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Listing
        </Link>
      </div>

      <div className="space-y-3">
        {listings.map((listing) => (
          <div key={listing.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="flex gap-4 p-4">
              {/* Thumbnail */}
              <div className="relative w-24 h-20 rounded-xl overflow-hidden shrink-0">
                <Image
                  src={listing.images[0]}
                  alt={listing.title}
                  fill
                  className="object-cover"
                  sizes="96px"
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400 font-medium">{listing.brand}</p>
                    <h3 className="font-bold text-[#111827] text-sm leading-snug truncate">{listing.title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{listing.city}, {listing.province}</p>
                  </div>
                  <span className="shrink-0 flex items-center gap-1 text-xs bg-green-50 text-[#22C55E] font-semibold px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                    Active
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <span className="text-sm font-bold text-[#2563EB]">₱{listing.daily_price.toLocaleString()}/day</span>
                  {listing.rating && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {listing.rating} ({listing.review_count})
                    </span>
                  )}
                  {listing.is_instant_book && (
                    <span className="flex items-center gap-1 text-xs text-[#F97316] font-medium">
                      <Zap className="w-3 h-3" /> Instant Book
                    </span>
                  )}
                  {listing.host?.is_verified && (
                    <span className="flex items-center gap-1 text-xs text-[#2563EB] font-medium">
                      <BadgeCheck className="w-3 h-3" /> Verified
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <Link
                href={`/listings/${listing.id}`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#2563EB] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </Link>
              <Link
                href={`/dashboard/listings/${listing.id}/edit`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#2563EB] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Link>
              <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-amber-600 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors ml-auto">
                <Pause className="w-3.5 h-3.5" /> Pause
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
