'use client'

import { ChevronRight, ChevronLeft, Info } from 'lucide-react'

interface PricingData {
  dailyPrice: string
  weeklyPrice: string
  monthlyPrice: string
  securityDeposit: string
}

interface Step3PricingProps {
  data: PricingData
  onChange: (d: PricingData) => void
  onNext: () => void
  onBack: () => void
}

export function Step3Pricing({ data, onChange, onNext, onBack }: Step3PricingProps) {
  function set(key: keyof PricingData, val: string) {
    onChange({ ...data, [key]: val.replace(/\D/g, '') })
  }

  const daily = Number(data.dailyPrice) || 0
  const weekly = Number(data.weeklyPrice) || 0
  const monthly = Number(data.monthlyPrice) || 0

  const weeklySavings  = daily > 0 && weekly > 0  ? Math.round(((daily * 7  - weekly)  / (daily * 7))  * 100) : 0
  const monthlySavings = daily > 0 && monthly > 0 ? Math.round(((daily * 30 - monthly) / (daily * 30)) * 100) : 0

  const serviceFee    = Math.round(daily * 0.12)
  const protectionFee = Math.round(daily * 0.05)
  const renterPays    = daily + serviceFee + protectionFee
  const hostReceives  = Math.round(daily * 0.88)

  const canContinue = daily >= 100 && Number(data.securityDeposit) >= 0

  const field = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 transition-all bg-white'
  const label = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Set your prices</h2>
        <p className="text-gray-500 text-sm mt-1">You can change these anytime after listing.</p>
      </div>

      {/* Daily price */}
      <div>
        <label className={label}>Daily Rate <span className="text-red-400">*</span></label>
        <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 bg-white">
          <span className="px-4 text-gray-400 font-semibold text-sm border-r border-gray-200 py-3">₱</span>
          <input
            value={data.dailyPrice}
            onChange={e => set('dailyPrice', e.target.value)}
            inputMode="numeric"
            placeholder="2,500"
            className="flex-1 px-4 py-3 text-sm text-gray-800 outline-none bg-transparent"
          />
          <span className="pr-4 text-gray-400 text-sm">/day</span>
        </div>
        {daily < 100 && data.dailyPrice && (
          <p className="text-xs text-red-500 mt-1">Minimum daily rate is ₱100</p>
        )}
      </div>

      {/* Earnings preview */}
      {daily >= 100 && (
        <div className="bg-[#F8FAFC] rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Earnings Preview (per day)</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Your daily rate</span>
              <span>₱{daily.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Rentivo service fee (12%)</span>
              <span className="text-red-400">-₱{serviceFee.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-[#22C55E] border-t border-gray-200 pt-2 mt-1">
              <span>You receive</span>
              <span>₱{hostReceives.toLocaleString()}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Renters pay ₱{renterPays.toLocaleString()}/day (includes service + protection fees).
          </p>
        </div>
      )}

      {/* Weekly + Monthly */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Weekly Rate <span className="font-normal text-gray-400 normal-case">(optional)</span></label>
          <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 bg-white">
            <span className="px-4 text-gray-400 font-semibold text-sm border-r border-gray-200 py-3">₱</span>
            <input
              value={data.weeklyPrice}
              onChange={e => set('weeklyPrice', e.target.value)}
              inputMode="numeric"
              placeholder={daily > 0 ? (daily * 6).toLocaleString() : '—'}
              className="flex-1 px-4 py-3 text-sm text-gray-800 outline-none bg-transparent"
            />
          </div>
          {weeklySavings > 0 && (
            <p className="text-xs text-[#22C55E] font-semibold mt-1">{weeklySavings}% discount vs daily</p>
          )}
        </div>
        <div>
          <label className={label}>Monthly Rate <span className="font-normal text-gray-400 normal-case">(optional)</span></label>
          <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 bg-white">
            <span className="px-4 text-gray-400 font-semibold text-sm border-r border-gray-200 py-3">₱</span>
            <input
              value={data.monthlyPrice}
              onChange={e => set('monthlyPrice', e.target.value)}
              inputMode="numeric"
              placeholder={daily > 0 ? (daily * 25).toLocaleString() : '—'}
              className="flex-1 px-4 py-3 text-sm text-gray-800 outline-none bg-transparent"
            />
          </div>
          {monthlySavings > 0 && (
            <p className="text-xs text-[#22C55E] font-semibold mt-1">{monthlySavings}% discount vs daily</p>
          )}
        </div>
      </div>

      {/* Security deposit */}
      <div>
        <label className={label}>Security Deposit</label>
        <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 bg-white">
          <span className="px-4 text-gray-400 font-semibold text-sm border-r border-gray-200 py-3">₱</span>
          <input
            value={data.securityDeposit}
            onChange={e => set('securityDeposit', e.target.value)}
            inputMode="numeric"
            placeholder="10,000"
            className="flex-1 px-4 py-3 text-sm text-gray-800 outline-none bg-transparent"
          />
        </div>
        <div className="flex items-start gap-2 mt-2 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Held during the rental and refunded upon safe return. Recommended: 3–5× the daily rate.
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          Continue <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
