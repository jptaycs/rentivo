'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MessageCircle, Check, X, Calendar, MapPin, Loader2, AlertCircle, Star } from 'lucide-react'
import { useHostBookings, type BookingWithRefs } from '@/hooks/useBookings'
import { useReviewedBookings } from '@/hooks/useReviewedBookings'
import { ReviewModal } from '@/components/shared/ReviewModal'

const TABS = ['All', 'Pending', 'Confirmed', 'Completed']

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#003049]',
  pending: 'bg-amber-50 text-amber-700',
  active: 'bg-blue-50 text-[#003049]',
  completed: 'bg-green-50 text-[#22C55E]',
  cancelled: 'bg-red-50 text-red-500',
}

export default function BookingsPage() {
  const [tab, setTab] = useState('All')
  const { bookings, loading, setStatus } = useHostBookings()
  const [actingOn, setActingOn] = useState('')
  const [error, setError] = useState('')
  const { reviewedIds, markReviewed } = useReviewedBookings()
  const [reviewing, setReviewing] = useState<BookingWithRefs | null>(null)

  const filtered = bookings.filter(
    (b) => tab === 'All' || b.status === tab.toLowerCase()
  )

  async function act(bookingId: string, status: 'confirmed' | 'cancelled') {
    setError('')
    setActingOn(bookingId)
    const err = await setStatus(bookingId, status)
    if (err) setError(err)
    setActingOn('')
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-[#111827]">Bookings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === t ? 'bg-white text-[#003049] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
            {t !== 'All' && (
              <span className="ml-1.5 text-xs opacity-60">
                {bookings.filter(b => b.status === t.toLowerCase()).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Bookings list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-16 text-gray-300">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No {tab.toLowerCase()} bookings</p>
          </div>
        ) : filtered.map((b) => (
          <div key={b.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#003049]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#003049] font-bold text-sm">
                      {(b.renter?.full_name || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-bold text-[#111827] text-sm">{b.renter?.full_name}</p>
                    <p className="text-xs text-gray-500">{b.booking_ref}</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${STATUS_STYLES[b.status]}`}>
                  {b.status}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Equipment</p>
                  <p className="font-semibold text-[#111827]">{b.listing?.title}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Dates</p>
                  <p className="font-semibold text-[#111827]">{fmt(b.pickup_date)} → {fmt(b.return_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Method</p>
                  <p className="font-semibold text-[#111827] flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-gray-400" />
                    {b.is_delivery ? 'Delivery' : 'Pickup'} · {b.listing?.city}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Total</p>
                  <p className="font-bold text-[#003049]">₱{b.total_amount.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <Link href={`/dashboard/messages?booking=${b.id}`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> Message
              </Link>
              {b.status === 'completed' && (
                reviewedIds.has(b.id) ? (
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#22C55E] px-3 py-1.5">
                    <Check className="w-3.5 h-3.5" /> Reviewed
                  </span>
                ) : (
                  <button
                    onClick={() => setReviewing(b)}
                    className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-amber-600 border border-amber-200 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Star className="w-3.5 h-3.5" /> Review Renter
                  </button>
                )
              )}
              {b.status === 'pending' && (
                <>
                  <button
                    onClick={() => act(b.id, 'confirmed')}
                    disabled={actingOn === b.id}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#003049] hover:bg-[#002438] disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors ml-auto"
                  >
                    {actingOn === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept
                  </button>
                  <button
                    onClick={() => act(b.id, 'cancelled')}
                    disabled={actingOn === b.id}
                    className="flex items-center gap-1.5 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Decline
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          open
          onClose={() => setReviewing(null)}
          bookingId={reviewing.id}
          revieweeId={reviewing.renter_id}
          revieweeName={reviewing.renter?.full_name ?? 'your renter'}
          onSubmitted={markReviewed}
        />
      )}
    </div>
  )
}
