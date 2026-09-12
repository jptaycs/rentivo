'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Calendar, MapPin, MessageCircle, Star, Package, Loader2, Check, X, AlertCircle, Navigation } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useMyRentals, type BookingWithRefs } from '@/hooks/useBookings'
import { useReviewedBookings } from '@/hooks/useReviewedBookings'
import { ReviewModal } from '@/components/shared/ReviewModal'
import { PickupLocationMap } from '@/components/booking/PickupLocationMap'

const TABS = ['Upcoming', 'History']

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#003049]',
  pending: 'bg-amber-50 text-amber-700',
  active: 'bg-blue-50 text-[#003049]',
  completed: 'bg-green-50 text-[#22C55E]',
  cancelled: 'bg-red-50 text-red-500',
}

const UPCOMING_STATUSES = ['pending', 'confirmed', 'active']

// Statuses that entitle a renter to the host's EXACT pickup point. Mirrors the
// allowlist inside get_listing_coordinates (067) — the RPC is the real gate, so
// if these ever disagree the RPC wins and the renter simply sees the
// unavailable state instead of a map.
const PICKUP_VISIBLE_STATUSES = ['confirmed', 'active', 'completed']

export default function RentalsPage() {
  const [tab, setTab] = useState('Upcoming')
  const { bookings, loading, cancel } = useMyRentals()
  const { reviewedIds, markReviewed } = useReviewedBookings()
  const [reviewing, setReviewing] = useState<BookingWithRefs | null>(null)
  const [cancellingId, setCancellingId] = useState('')
  const [error, setError] = useState('')
  // Exact pickup point. Fetched on open rather than for every booking in the
  // list: it is the host's precise location, so it is requested only when the
  // renter actually asks to see it.
  const [pickupBookingId, setPickupBookingId] = useState('')
  const [pickup, setPickup] = useState<{ lat: number; lng: number; address: string | null } | null>(null)
  const [pickupLoading, setPickupLoading] = useState(false)
  const [pickupUnavailable, setPickupUnavailable] = useState(false)

  async function togglePickup(booking: BookingWithRefs) {
    if (pickupBookingId === booking.id) {
      setPickupBookingId('')
      return
    }
    setPickupBookingId(booking.id)
    setPickup(null)
    setPickupUnavailable(false)
    // A listing whose host never placed a pin still HAS coordinates — the
    // city centre, from the 066 backfill — and the RPC returns them happily.
    // Showing those under an "exact pickup point" heading would be a lie of
    // exactly the kind location_is_exact exists to prevent, so check the flag
    // before asking. It rides along on the booking's listing join
    // (LISTING_COLUMNS), so this costs no extra request.
    if (!booking.listing?.location_is_exact) {
      setPickupUnavailable(true)
      return
    }
    setPickupLoading(true)
    // get_listing_coordinates returns ZERO ROWS rather than raising when the
    // caller isn't entitled, so an empty result is the normal "not yours yet"
    // answer, not an error. It also comes back empty for a listing whose host
    // has never placed a pin. Both land on the same honest message.
    const { data, error: rpcError } = await createClient()
      .rpc('get_listing_coordinates', { p_listing_id: booking.listing_id })
    const row = Array.isArray(data) ? data[0] : null
    if (rpcError || !row || row.latitude == null || row.longitude == null) {
      setPickupUnavailable(true)
    } else {
      // street_address is optional and null on most listings — the panel shows
      // the map alone in that case rather than an empty line.
      const address = typeof row.street_address === 'string' && row.street_address.trim()
        ? row.street_address.trim()
        : null
      setPickup({ lat: Number(row.latitude), lng: Number(row.longitude), address })
    }
    setPickupLoading(false)
  }

  async function handleCancel(booking: BookingWithRefs) {
    // A host_qr booking was paid directly to the host — Rentivo never held that
    // money and so genuinely cannot refund it. Promising a refund here would be
    // false, same reasoning as the cancellation email copy in src/lib/email.ts.
    const refundNote =
      booking.payment_status !== 'paid'
        ? ''
        : booking.payment_method === 'host_qr'
          ? ' Since this booking was paid directly to the host via QR code, any refund needs to be arranged directly with them.'
          : ' You will be refunded in full.'
    if (!confirm(`Cancel your booking for ${booking.listing?.title}?${refundNote}`)) return
    setError('')
    setCancellingId(booking.id)
    const err = await cancel(booking.id)
    if (err) setError(err)
    setCancellingId('')
  }

  const items = bookings.filter((b) =>
    tab === 'Upcoming'
      ? UPCOMING_STATUSES.includes(b.status)
      : !UPCOMING_STATUSES.includes(b.status)
  )

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-[#111827]">My Rentals</h1>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === t ? 'bg-white text-[#003049] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-20 text-gray-300">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No {tab.toLowerCase()} rentals</p>
            <Link href="/search" className="text-sm text-[#003049] hover:underline mt-2 inline-block">Browse equipment →</Link>
          </div>
        ) : items.map((item) => (
          <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex gap-4 p-5">
              <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-gray-100">
                {item.listing?.images[0] && (
                  <Image src={item.listing.images[0]} alt={item.listing.title} fill className="object-cover" sizes="80px" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-400">{item.listing?.brand}</p>
                    <h3 className="font-bold text-[#111827] text-sm line-clamp-1">{item.listing?.title}</h3>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize shrink-0 ${STATUS_STYLES[item.status]}`}>
                    {item.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{fmt(item.pickup_date)} → {fmt(item.return_date)}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.listing?.city}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{item.booking_ref}</p>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <Link href={`/listings/${item.listing_id}`}
                className="text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                View listing
              </Link>
              <Link href={`/dashboard/messages?view=renter&booking=${item.id}`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> Message Host
              </Link>
              {PICKUP_VISIBLE_STATUSES.includes(item.status) && (
                <button
                  onClick={() => togglePickup(item)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#003049] border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  {pickupBookingId === item.id ? 'Hide Pickup Location' : 'Show Pickup Location'}
                </button>
              )}
              {item.status === 'pending' && (
                <button
                  onClick={() => handleCancel(item)}
                  disabled={cancellingId === item.id}
                  className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {cancellingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Cancel
                </button>
              )}
              {item.status === 'completed' && (
                reviewedIds.has(item.id) ? (
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#22C55E] px-3 py-1.5">
                    <Check className="w-3.5 h-3.5" /> Reviewed
                  </span>
                ) : (
                  <button
                    onClick={() => setReviewing(item)}
                    className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-amber-600 border border-amber-200 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Star className="w-3.5 h-3.5" /> Leave Review
                  </button>
                )
              )}
            </div>

            {pickupBookingId === item.id && (
              <div className="px-5 py-5 border-t border-gray-100 bg-blue-50/30">
                {pickupLoading ? (
                  <div className="w-full h-56 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-300">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : pickup ? (
                  <PickupLocationMap
                    lat={pickup.lat}
                    lng={pickup.lng}
                    city={item.listing?.city ?? ''}
                    province={item.listing?.province ?? ''}
                    address={pickup.address}
                  />
                ) : pickupUnavailable ? (
                  <p className="text-sm text-gray-600">
                    Pickup location isn&apos;t available for this booking yet. Your host hasn&apos;t
                    marked their exact pickup point — message them to arrange where to collect the gear.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          open
          onClose={() => setReviewing(null)}
          bookingId={reviewing.id}
          revieweeId={reviewing.host_id}
          revieweeName={reviewing.host?.full_name ?? 'your host'}
          listingId={reviewing.listing_id}
          onSubmitted={markReviewed}
        />
      )}
    </div>
  )
}
