'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Zap, Star, Shield, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { calcPricing } from '@/lib/pricing'
import type { Listing } from '@/types'

interface BookingPanelProps {
  listing: Listing
}

export function BookingPanel({ listing }: BookingPanelProps) {
  const router = useRouter()
  const [pickupDate, setPickupDate] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!pickupDate || !returnDate || returnDate <= pickupDate || !isSupabaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset availability on invalid/incomplete date input; no test suite to safely verify a rewrite (see AGENTS.md)
      setAvailable(null)
      return
    }
    let cancelled = false
    createClient()
      .rpc('is_listing_available', {
        p_listing_id: listing.id,
        p_from: pickupDate,
        p_to: returnDate,
      })
      .then(({ data }) => {
        if (!cancelled) setAvailable(data ?? true)
      })
    return () => { cancelled = true }
  }, [pickupDate, returnDate, listing.id])

  const days = pickupDate && returnDate
    ? Math.max(
        1,
        Math.ceil(
          (new Date(returnDate).getTime() - new Date(pickupDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0

  const { rentalFee, tier, serviceFee, protectionFee, total } = calcPricing(listing, days)
  const effectiveRate = days > 0 ? Math.round(rentalFee / days) : listing.daily_price

  function handleBook() {
    if (!pickupDate || !returnDate) return
    const params = new URLSearchParams({
      listing: listing.id,
      from: pickupDate,
      to: returnDate,
    })
    router.push(`/book?${params.toString()}`)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6 space-y-5">
      {/* Price */}
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-[#111827]">
            ₱{listing.daily_price.toLocaleString()}
          </span>
          <span className="text-gray-500 text-sm">/day</span>
        </div>
        {listing.rating && (
          <div className="flex items-center gap-1 mt-1">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="text-sm font-semibold">{listing.rating}</span>
            <span className="text-xs text-gray-400">· {listing.review_count} reviews</span>
          </div>
        )}
        {listing.is_instant_book && (
          <div className="flex items-center gap-1 mt-2 text-[#003049]">
            <Zap className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">Instant Book available</span>
          </div>
        )}
      </div>

      {/* Date picker */}
      <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <Calendar className="w-4 h-4 text-[#003049] shrink-0" />
          <div className="flex-1">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Pickup</p>
            <input
              type="date"
              value={pickupDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setPickupDate(e.target.value)}
              className="text-sm text-gray-800 outline-none bg-transparent w-full mt-0.5"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Calendar className="w-4 h-4 text-[#003049] shrink-0" />
          <div className="flex-1">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Return</p>
            <input
              type="date"
              value={returnDate}
              min={pickupDate || new Date().toISOString().split('T')[0]}
              onChange={(e) => setReturnDate(e.target.value)}
              className="text-sm text-gray-800 outline-none bg-transparent w-full mt-0.5"
            />
          </div>
        </div>
      </div>

      {/* Pricing breakdown */}
      {days > 0 && (
        <div className="space-y-2 text-sm border-t border-gray-100 pt-4">
          <div className="flex justify-between text-gray-600">
            <span>
              ₱{effectiveRate.toLocaleString()} × {days} day{days > 1 ? 's' : ''}
              {tier !== 'daily' && (
                <span className="ml-1.5 text-xs font-medium text-[#22C55E]">
                  {tier === 'weekly' ? 'Weekly rate applied' : 'Monthly rate applied'}
                </span>
              )}
            </span>
            <span>₱{rentalFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Service fee</span>
            <span>₱{serviceFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Protection fee</span>
            <span>₱{protectionFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Security deposit <span className="text-xs">(refundable)</span></span>
            <span>₱{listing.security_deposit.toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-bold text-[#111827] text-base border-t border-gray-200 pt-3 mt-1">
            <span>Total</span>
            <span>₱{total.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Availability warning */}
      {available === false && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          These dates are unavailable. Please pick a different range.
        </div>
      )}

      {/* CTA */}
      <button
        onClick={handleBook}
        disabled={!pickupDate || !returnDate || available === false}
        className="w-full bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
      >
        {pickupDate && returnDate ? `Book Now — ₱${total.toLocaleString()}` : 'Select dates to book'}
      </button>

      {/* Trust note */}
      <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
        <Shield className="w-3.5 h-3.5 text-[#22C55E]" />
        Equipment protection included
      </div>
    </div>
  )
}
