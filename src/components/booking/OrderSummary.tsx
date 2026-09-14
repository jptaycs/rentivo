import Image from 'next/image'
import { Star, Shield, BadgeCheck } from 'lucide-react'
import type { Listing } from '@/types'
import { calcPricing, formatFeeRate, type StoredBookingAmounts } from '@/lib/pricing'

interface OrderSummaryProps {
  listing: Listing
  pickupDate: string
  returnDate: string
  days: number
  /** The live platform service-fee rate, read on the server (080/081). */
  serviceFeeBps: number
  isDelivery?: boolean
  /** 078: the server's quote for the renter's pin (per-km listings only). */
  deliveryQuote?: { fee: number | null; roadKm: number | null; loading: boolean }
  /**
   * The booking checkout already created for the current choice and pin. When
   * present every figure comes from the stored row, never the quote: a host may
   * have changed a rate in between, and the stored total is what is charged.
   */
  stored?: StoredBookingAmounts | null
}

export function OrderSummary({ listing, pickupDate, returnDate, days, serviceFeeBps, isDelivery, deliveryQuote, stored }: OrderSummaryProps) {
  const perKm = !!isDelivery && listing.delivery_fee_per_km > 0
  const quotedFee = deliveryQuote && !deliveryQuote.loading ? deliveryQuote.fee : null
  const priced = calcPricing(listing, days, serviceFeeBps, isDelivery, perKm ? quotedFee : null)
  const tier = priced.tier
  const rentalFee = stored ? stored.rental_fee : priced.rentalFee
  const serviceFee = stored ? stored.service_fee : priced.serviceFee
  // Once a booking exists, the rate it was STAMPED with (081) is the rate the
  // renter will actually be charged at — the live rate may have moved since.
  // A pre-080 booking has none, so the live rate is the only figure to show.
  const feeRateBps = stored?.service_fee_bps ?? serviceFeeBps
  const deliveryFee = stored ? stored.delivery_fee : priced.deliveryFee
  const total = stored ? stored.total_amount : priced.total
  const deliveryKm = stored
    ? stored.delivery_distance_km
    : perKm && deliveryQuote && !deliveryQuote.loading
      ? deliveryQuote.roadKm
      : null
  // A per-km delivery has no price until the server quotes the pin. Showing the
  // base fee as if it were the whole charge would understate the total.
  const deliveryUnpriced = !stored && perKm && quotedFee === null
  const effectiveRate = days > 0 ? Math.round(rentalFee / days) : listing.daily_price

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
      {/* Listing */}
      <div className="flex gap-4">
        <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0">
          <Image
            src={listing.images[0] ?? '/placeholder-equipment.jpg'}
            alt={listing.title}
            fill
            className="object-cover"
            sizes="80px"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 font-medium">{listing.brand}</p>
          <p className="font-semibold text-[#111827] text-sm leading-snug line-clamp-2 mt-0.5">
            {listing.title}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            {listing.host?.is_verified && (
              <span className="flex items-center gap-0.5 text-[#003049] text-xs font-medium">
                <BadgeCheck className="w-3.5 h-3.5" /> Verified
              </span>
            )}
            {listing.rating && (
              <span className="flex items-center gap-0.5 text-xs text-gray-500">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {listing.rating}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="bg-[#F8FAFC] rounded-xl p-4 text-sm space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500">Pickup</span>
          <span className="font-medium text-[#111827]">{fmt(pickupDate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Return</span>
          <span className="font-medium text-[#111827]">{fmt(returnDate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Duration</span>
          <span className="font-medium text-[#111827]">{days} day{days > 1 ? 's' : ''}</span>
        </div>
        {isDelivery !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-500">Method</span>
            <span className="font-medium text-[#111827]">{isDelivery ? 'Delivery' : 'Pickup'}</span>
          </div>
        )}
      </div>

      {/* Price breakdown */}
      <div className="space-y-2 text-sm">
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
          <span>Service fee ({formatFeeRate(feeRateBps)})</span>
          <span>₱{serviceFee.toLocaleString()}</span>
        </div>
        {deliveryUnpriced ? (
          <div className="flex justify-between text-gray-600">
            <span>Delivery</span>
            <span className="text-gray-400">
              {deliveryQuote?.loading ? 'Calculating…' : 'Set your pin'}
            </span>
          </div>
        ) : (
          deliveryFee > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>{deliveryKm != null ? `Delivery (${deliveryKm} km)` : 'Delivery fee'}</span>
              <span>₱{deliveryFee.toLocaleString()}</span>
            </div>
          )
        )}
        <div className="flex justify-between font-bold text-[#111827] text-base border-t border-gray-200 pt-3 mt-1">
          <span>Total</span>
          <span>{deliveryUnpriced ? '—' : `₱${total.toLocaleString()}`}</span>
        </div>
      </div>

      {/* Trust note */}
      <div className="flex items-center gap-2 text-xs text-gray-400 border-t border-gray-100 pt-4">
        <Shield className="w-4 h-4 text-[#22C55E] shrink-0" />
        Secure payments included
      </div>
    </div>
  )
}
