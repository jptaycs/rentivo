'use client'

import { MapPin, Truck, ChevronRight, ChevronLeft, Check } from 'lucide-react'
import type { Listing } from '@/types'

interface Step2PickupProps {
  listing: Listing
  isDelivery: boolean
  deliveryAddress: string
  onDeliveryChange: (val: boolean) => void
  onAddressChange: (val: string) => void
  onNext: () => void
  onBack: () => void
}

export function Step2Pickup({
  listing,
  isDelivery,
  deliveryAddress,
  onDeliveryChange,
  onAddressChange,
  onNext,
  onBack,
}: Step2PickupProps) {
  const canContinue = !isDelivery || deliveryAddress.trim().length > 5
  const offersDelivery = listing.delivery_fee !== null
  const deliveryFee = listing.delivery_fee ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">How do you want to get it?</h2>
        <p className="text-gray-500 mt-1 text-sm">
          {offersDelivery
            ? 'Choose between picking up from the host or having it delivered.'
            : 'This host offers pickup only.'}
        </p>
      </div>

      {/* Option cards — delivery is hidden entirely when the host doesn't
          offer it (delivery_fee is null), so Pickup spans the full row. */}
      <div className={`grid grid-cols-1 gap-4 ${offersDelivery ? 'sm:grid-cols-2' : ''}`}>
        {/* Pickup */}
        <button
          onClick={() => onDeliveryChange(false)}
          className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all text-left ${
            !isDelivery
              ? 'border-[#003049] bg-blue-50/50'
              : 'border-gray-200 bg-white hover:border-blue-200'
          }`}
        >
          {!isDelivery && (
            <span className="absolute top-3 right-3 w-5 h-5 bg-[#003049] rounded-full flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </span>
          )}
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
            !isDelivery ? 'bg-[#003049] text-white' : 'bg-gray-100 text-gray-500'
          }`}>
            <MapPin className="w-6 h-6" />
          </div>
          <div className="text-center">
            <p className={`font-bold ${!isDelivery ? 'text-[#003049]' : 'text-[#111827]'}`}>
              Pickup
            </p>
            <p className="text-xs text-gray-500 mt-1">Collect from the host&apos;s location</p>
            <p className="text-xs font-semibold text-[#22C55E] mt-2">Free</p>
          </div>
        </button>

        {/* Delivery */}
        {offersDelivery && (
        <button
          onClick={() => onDeliveryChange(true)}
          className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all text-left ${
            isDelivery
              ? 'border-[#003049] bg-blue-50/50'
              : 'border-gray-200 bg-white hover:border-blue-200'
          }`}
        >
          {isDelivery && (
            <span className="absolute top-3 right-3 w-5 h-5 bg-[#003049] rounded-full flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </span>
          )}
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
            isDelivery ? 'bg-[#003049] text-white' : 'bg-gray-100 text-gray-500'
          }`}>
            <Truck className="w-6 h-6" />
          </div>
          <div className="text-center">
            <p className={`font-bold ${isDelivery ? 'text-[#003049]' : 'text-[#111827]'}`}>
              Delivery
            </p>
            <p className="text-xs text-gray-500 mt-1">Host delivers to your location</p>
            <p className={`text-xs font-semibold mt-2 ${deliveryFee > 0 ? 'text-[#003049]' : 'text-[#22C55E]'}`}>
              {deliveryFee > 0 ? `₱${deliveryFee.toLocaleString()}` : 'Free'}
            </p>
          </div>
        </button>
        )}
      </div>

      {/* Pickup details */}
      {!isDelivery && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-[#003049] mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-[#111827] text-sm">Host pickup address</p>
              <p className="text-sm text-gray-500 mt-1">{listing.city}, {listing.province}</p>
              <p className="text-xs text-gray-400 mt-2">
                Exact address will be shared after booking is confirmed by the host.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Delivery address input */}
      {isDelivery && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <label className="block text-sm font-bold text-[#111827]">
            Delivery Address <span className="text-red-400">*</span>
          </label>
          <textarea
            value={deliveryAddress}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Enter your full delivery address including unit/floor, street, barangay, city, province…"
            rows={3}
            className="w-full text-sm text-gray-800 placeholder-gray-400 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 resize-none"
          />
          <p className="text-xs text-gray-400">
            {deliveryFee > 0
              ? `A ₱${deliveryFee.toLocaleString()} delivery fee is included in your total.`
              : 'This host delivers for free.'}
          </p>
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          Continue to Payment <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
