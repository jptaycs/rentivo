'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Calendar, MapPin, MessageCircle, Star, Package, Loader2, Check, X, AlertCircle, QrCode } from 'lucide-react'
import { useMyRentals, type BookingWithRefs } from '@/hooks/useBookings'
import { useReviewedBookings } from '@/hooks/useReviewedBookings'
import { ReviewModal } from '@/components/shared/ReviewModal'

const TABS = ['Upcoming', 'History']

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#003049]',
  pending: 'bg-amber-50 text-amber-700',
  active: 'bg-blue-50 text-[#003049]',
  completed: 'bg-green-50 text-[#22C55E]',
  cancelled: 'bg-red-50 text-red-500',
}

const UPCOMING_STATUSES = ['pending', 'confirmed', 'active']

export default function RentalsPage() {
  const [tab, setTab] = useState('Upcoming')
  const { bookings, loading, cancel } = useMyRentals()
  const { reviewedIds, markReviewed } = useReviewedBookings()
  const [reviewing, setReviewing] = useState<BookingWithRefs | null>(null)
  const [cancellingId, setCancellingId] = useState('')
  const [error, setError] = useState('')
  // Host-QR payment: the renter can reopen the QR any time before it's paid —
  // the signed URL is short-lived, so it's fetched fresh on each open rather
  // than eagerly for every booking in the list.
  const [qrBookingId, setQrBookingId] = useState('')
  const [qr, setQr] = useState<{ url: string; label: string | null } | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')

  async function toggleQr(booking: BookingWithRefs) {
    if (qrBookingId === booking.id) {
      setQrBookingId('')
      return
    }
    setQrBookingId(booking.id)
    setQr(null)
    setQrError('')
    setQrLoading(true)
    try {
      const res = await fetch(`/api/bookings/${booking.id}/qr`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) throw new Error(data?.error ?? 'Could not load the QR code.')
      setQr({ url: data.url, label: data.label ?? null })
    } catch (e) {
      setQrError(e instanceof Error ? e.message : 'Could not load the QR code.')
    }
    setQrLoading(false)
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
              <Link href={`/dashboard/messages?booking=${item.id}`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> Message Host
              </Link>
              {item.payment_method === 'host_qr' &&
                item.payment_status === 'unpaid' &&
                item.status !== 'cancelled' && (
                  <button
                    onClick={() => toggleQr(item)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 border border-purple-200 hover:bg-purple-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    {qrBookingId === item.id ? 'Hide Payment QR' : 'View Payment QR'}
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

            {qrBookingId === item.id && (
              <div className="px-5 py-5 border-t border-gray-100 bg-purple-50/40 text-center space-y-2">
                {qrLoading ? (
                  <div className="w-48 h-48 mx-auto rounded-xl bg-gray-100 flex items-center justify-center text-gray-300">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : qrError ? (
                  <div className="w-48 h-48 mx-auto rounded-xl bg-red-50 border border-red-100 flex items-center justify-center px-4 text-xs text-red-600 text-center">
                    {qrError}
                  </div>
                ) : qr ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket, not a next/image remotePattern candidate
                  <img src={qr.url} alt="Host's payment QR code" className="w-48 h-48 mx-auto rounded-xl object-cover" />
                ) : null}
                {qr?.label && <p className="text-sm font-semibold text-[#111827]">{qr.label}</p>}
                <p className="text-xs text-gray-500">
                  Pay ₱{item.total_amount.toLocaleString()}{' '}
                  directly to your host — Rentivo doesn&apos;t process or hold this payment.
                  They&apos;ll mark it received once it arrives.
                </p>
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
