import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { ChevronLeft, XCircle, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPayMongoConfigured, getPaymentIntent } from '@/lib/paymongo'
import { notifyBookingPaid } from '@/lib/email'
import { Step4Confirmation } from '@/components/booking/Step4Confirmation'
import type { Booking, Listing } from '@/types'

/**
 * Return page after PayMongo redirects (GCash / Maya authorization,
 * card 3DS). Verifies the payment intent server-side and marks the
 * booking paid — the webhook does the same in production, but this
 * covers local dev and gives the user an immediate answer.
 */

interface CompletePageProps {
  searchParams: Promise<{ booking?: string }>
}

const BOOKING_SELECT = '*, listing:listings!bookings_listing_id_fkey(*, host:profiles!listings_host_id_fkey(*))'

export default async function BookingCompletePage({ searchParams }: CompletePageProps) {
  const { booking: bookingId } = await searchParams
  if (!bookingId) redirect('/')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('id', bookingId)
    .single()
  if (!data) notFound()

  let booking = data as unknown as Booking & { listing: Listing }
  let processing = false

  if (booking.payment_status !== 'paid' && booking.paymongo_ref && isPayMongoConfigured()) {
    try {
      const intent = await getPaymentIntent(booking.paymongo_ref)
      if (intent.attributes.status === 'succeeded') {
        const admin = createAdminClient()
        const { data: paid } = await admin.rpc('mark_booking_paid', {
          p_booking_id: booking.id,
          p_paymongo_ref: booking.paymongo_ref,
        })
        if (paid) {
          booking = { ...booking, ...(paid as Booking) }
          notifyBookingPaid(booking.id).catch((e) => console.error('[email] notifyBookingPaid failed', e))
        }
      } else if (intent.attributes.status === 'processing') {
        processing = true
      }
    } catch {
      // Verification failed — fall through to the unpaid state below
    }
  }

  const isPaid = booking.payment_status === 'paid'

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link
            href={`/listings/${booking.listing_id}`}
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

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isPaid ? (
          <Step4Confirmation listing={booking.listing} booking={booking} />
        ) : processing ? (
          <div className="text-center py-16 space-y-4">
            <Loader2 className="w-12 h-12 text-[#003049] animate-spin mx-auto" />
            <h2 className="text-2xl font-bold text-[#111827]">Payment processing…</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              Your payment is still being processed. This usually takes a few seconds — refresh
              this page to check again.
            </p>
            <Link
              href={`/book/complete?booking=${booking.id}`}
              className="inline-flex items-center justify-center bg-[#003049] hover:bg-[#002438] text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors"
            >
              Check again
            </Link>
          </div>
        ) : (
          <div className="text-center py-16 space-y-4">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <XCircle className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-[#111827]">Payment not completed</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              Your payment was cancelled or could not be completed. No amount was charged — you
              can try again with the same or a different payment method.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Link
                href={`/book?listing=${booking.listing_id}&from=${booking.pickup_date}&to=${booking.return_date}`}
                className="inline-flex items-center justify-center bg-[#003049] hover:bg-[#002438] text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors"
              >
                Try again
              </Link>
              <Link
                href="/"
                className="inline-flex items-center justify-center border border-gray-200 text-gray-600 hover:bg-gray-50 font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
              >
                Back to Home
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
