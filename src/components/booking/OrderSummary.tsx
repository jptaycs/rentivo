import Image from 'next/image'
import { Star, Shield, BadgeCheck } from 'lucide-react'
import type { Listing } from '@/types'
import { calcPricing } from '@/lib/pricing'

interface OrderSummaryProps {
  listing: Listing
  pickupDate: string
  returnDate: string
  days: number
  isDelivery?: boolean
}

export function OrderSummary({ listing, pickupDate, returnDate, days, isDelivery }: OrderSummaryProps) {
  const { rentalFee, tier, serviceFee, total } = calcPricing(listing, days)
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
          <span>Service fee (5%)</span>
          <span>₱{serviceFee.toLocaleString()}</span>
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

      {/* Trust note */}
      <div className="flex items-center gap-2 text-xs text-gray-400 border-t border-gray-100 pt-4">
        <Shield className="w-4 h-4 text-[#22C55E] shrink-0" />
        Secure payments included
      </div>
    </div>
  )
}
