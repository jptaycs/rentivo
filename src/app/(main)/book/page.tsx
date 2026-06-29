import { redirect, notFound } from 'next/navigation'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { BookingWizard } from '@/components/booking/BookingWizard'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

interface BookPageProps {
  searchParams: Promise<{
    listing?: string
    from?: string
    to?: string
  }>
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const { listing: listingId, from, to } = await searchParams

  if (!listingId || !from || !to) redirect('/')

  const listing = MOCK_LISTINGS.find((l) => l.id === listingId)
  if (!listing) notFound()

  const pickupDate = from
  const returnDate = to
  const days = Math.max(
    1,
    Math.ceil(
      (new Date(returnDate).getTime() - new Date(pickupDate).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  )

  if (days < 1) redirect(`/listings/${listingId}`)

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link
            href={`/listings/${listingId}`}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#003049] transition-colors font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to listing
          </Link>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
            Secure Checkout
          </div>
        </div>
      </div>

      <BookingWizard
        listing={listing}
        pickupDate={pickupDate}
        returnDate={returnDate}
        days={days}
      />
    </div>
  )
}
