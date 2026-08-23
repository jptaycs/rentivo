import { Calendar, ChevronRight, MapPin } from 'lucide-react'
import type { Listing } from '@/types'

interface Step1ReviewProps {
  listing: Listing
  pickupDate: string
  returnDate: string
  days: number
  onNext: () => void
}

export function Step1Review({ listing, pickupDate, returnDate, days, onNext }: Step1ReviewProps) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Review your rental</h2>
        <p className="text-gray-500 mt-1 text-sm">Make sure everything looks correct before continuing.</p>
      </div>

      {/* Date summary card */}
      <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        <div className="flex items-center gap-4 p-5">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5 text-[#003049]" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Pickup Date</p>
            <p className="font-semibold text-[#111827]">{fmt(pickupDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-5">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5 text-[#003049]" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Return Date</p>
            <p className="font-semibold text-[#111827]">{fmt(returnDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-5 bg-blue-50/50">
          <div className="w-10 h-10 bg-[#003049] rounded-xl flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">{days}</span>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Total Duration</p>
            <p className="font-semibold text-[#111827]">{days} day{days > 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Pickup location hint */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
        <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
        <p>
          This equipment is located in <strong>{listing.city}, {listing.province}</strong>. You&apos;ll choose between pickup or delivery in the next step.
        </p>
      </div>

      {/* Cancellation policy */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-bold text-[#111827] mb-2">Cancellation Policy</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          Free cancellation up to <strong>48 hours before pickup</strong>. Cancellations within 48 hours are charged 50% of the rental fee. No-shows are charged in full.
        </p>
      </div>

      <button
        onClick={onNext}
        className="w-full bg-[#003049] hover:bg-[#002438] text-white font-bold py-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        Continue to Pickup Options
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
