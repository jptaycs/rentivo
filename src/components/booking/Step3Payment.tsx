'use client'

import { useState } from 'react'
import { ChevronLeft, Lock, Loader2, Check, Tag, X, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import { calcPricing } from './OrderSummary'
import type { Listing } from '@/types'

type PaymentMethod = 'gcash' | 'maya' | 'card' | 'apple_pay' | 'google_pay'

export interface CheckoutPayload {
  method: PaymentMethod
  phone?: string
  promoCode?: string
  paymentMethodId?: string
}

interface Step3PaymentProps {
  listing: Listing
  days: number
  onNext: (payload: CheckoutPayload) => Promise<void>
  onBack: () => void
}

interface AppliedPromo {
  code: string
  pct: number | null
  flat: number | null
}

const PAYMONGO_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY

const METHODS: {
  id: PaymentMethod
  label: string
  logo: string
  color: string
  comingSoon?: boolean
}[] = [
  { id: 'gcash', label: 'GCash', logo: '/logos/gcash.svg', color: 'border-blue-400' },
  { id: 'maya', label: 'Maya', logo: '/logos/maya.svg', color: 'border-green-400' },
  { id: 'card', label: 'Credit / Debit Card', logo: '/logos/card.svg', color: 'border-gray-300' },
  { id: 'apple_pay', label: 'Apple Pay', logo: '/logos/apple-pay.svg', color: 'border-gray-900', comingSoon: true },
  { id: 'google_pay', label: 'Google Pay', logo: '/logos/google-pay.svg', color: 'border-gray-300', comingSoon: true },
]

/** Card data goes straight to PayMongo with the public key — never to our server. */
async function createCardPaymentMethod(card: {
  number: string
  expMonth: number
  expYear: number
  cvc: string
  name: string
  email: string
}): Promise<string> {
  const res = await fetch('https://api.paymongo.com/v1/payment_methods', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${PAYMONGO_PUBLIC_KEY}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          type: 'card',
          details: {
            card_number: card.number,
            exp_month: card.expMonth,
            exp_year: card.expYear,
            cvc: card.cvc,
          },
          billing: { name: card.name, email: card.email },
        },
      },
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = json?.errors?.map((e: { detail?: string }) => e.detail).filter(Boolean).join(' ')
    throw new Error(detail || 'Your card could not be processed. Please check your details.')
  }
  return json.data.id as string
}

export function Step3Payment({ listing, days, onNext, onBack }: Step3PaymentProps) {
  const { user } = useUser()
  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [mobileNumber, setMobileNumber] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardName, setCardName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [payError, setPayError] = useState('')
  const [promo, setPromo] = useState<AppliedPromo | null>(null)
  const [promoInput, setPromoInput] = useState('')
  const [promoError, setPromoError] = useState('')
  const [promoChecking, setPromoChecking] = useState(false)

  async function applyPromo() {
    const code = promoInput.trim().toUpperCase()
    if (!code) return
    setPromoChecking(true)
    setPromoError('')
    const supabase = createClient()
    const { data, error } = await supabase.rpc('validate_promo_code', { p_code: code })
    setPromoChecking(false)
    const row = data?.[0]
    if (error || !row) {
      setPromoError('Invalid or expired promo code.')
      setPromo(null)
      return
    }
    setPromo({ code: row.code, pct: row.discount_pct, flat: row.discount_flat })
  }

  function removePromo() {
    setPromo(null)
    setPromoInput('')
    setPromoError('')
  }

  const { rentalFee, total: baseTotal } = calcPricing(listing, days)
  // Discount applies to the rental fee only — never the refundable deposit
  const discount = promo
    ? Math.min(rentalFee, Math.round((rentalFee * (promo.pct ?? 0)) / 100) + (promo.flat ?? 0))
    : 0
  const total = baseTotal - discount

  const isWallet = method === 'gcash' || method === 'maya'
  const isCard = method === 'card'

  const canPay =
    agreed &&
    ((isWallet && mobileNumber.replace(/\D/g, '').length === 11) ||
      (isCard && cardNumber.replace(/\s/g, '').length === 16 && cardExpiry && cardCvv.length >= 3 && cardName))

  function formatCard(val: string) {
    return val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()
  }

  function formatExpiry(val: string) {
    const digits = val.replace(/\D/g, '').slice(0, 4)
    return digits.length >= 3 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
  }

  async function handlePay() {
    if (!canPay) return
    setLoading(true)
    setPayError('')
    try {
      let paymentMethodId: string | undefined
      if (isCard && PAYMONGO_PUBLIC_KEY) {
        paymentMethodId = await createCardPaymentMethod({
          number: cardNumber.replace(/\s/g, ''),
          expMonth: Number(cardExpiry.slice(0, 2)),
          expYear: 2000 + Number(cardExpiry.slice(3)),
          cvc: cardCvv,
          name: cardName,
          email: user?.email ?? '',
        })
      }
      await onNext({
        method,
        phone: isWallet ? `+63${mobileNumber.replace(/\D/g, '').slice(1)}` : undefined,
        promoCode: promo?.code,
        paymentMethodId,
      })
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Payment</h2>
        <p className="text-gray-500 mt-1 text-sm">Choose your payment method and complete your booking.</p>
      </div>

      {/* Payment method selector */}
      <div>
        <p className="text-sm font-bold text-gray-700 mb-3">Payment Method</p>
        <div className="space-y-2">
          {METHODS.map((m) => (
            <label
              key={m.id}
              className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                m.comingSoon
                  ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                  : method === m.id
                    ? `${m.color} bg-blue-50/40 cursor-pointer`
                    : 'border-gray-200 bg-white hover:border-gray-300 cursor-pointer'
              }`}
            >
              <input
                type="radio"
                name="payment"
                value={m.id}
                checked={method === m.id}
                disabled={m.comingSoon}
                onChange={() => setMethod(m.id)}
                className="sr-only"
              />
              {/* Custom radio */}
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                method === m.id ? 'border-[#003049]' : 'border-gray-300'
              }`}>
                {method === m.id && (
                  <div className="w-2.5 h-2.5 rounded-full bg-[#003049]" />
                )}
              </div>
              {/* Logo placeholder */}
              <div className="w-10 h-7 bg-gray-100 rounded-md flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">
                {m.label.split(' ')[0].slice(0, 4).toUpperCase()}
              </div>
              <span className="font-medium text-[#111827] text-sm">{m.label}</span>
              {m.comingSoon && (
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-100 rounded-full px-2.5 py-1">
                  Coming soon
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Mobile number for GCash / Maya */}
      {isWallet && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <label className="block text-sm font-bold text-[#111827]">
            {method === 'gcash' ? 'GCash' : 'Maya'} Mobile Number
          </label>
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-3 focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100">
            <span className="text-sm text-gray-500 font-medium">+63</span>
            <div className="w-px h-4 bg-gray-200" />
            <input
              type="tel"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="09XX XXX XXXX"
              className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
            />
          </div>
          <p className="text-xs text-gray-400">
            You&apos;ll be redirected to {method === 'gcash' ? 'GCash' : 'Maya'} to authorize the payment.
          </p>
        </div>
      )}

      {/* Card fields */}
      {isCard && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Card Number
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCard(e.target.value))}
              placeholder="1234 5678 9012 3456"
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                Expiry
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={cardExpiry}
                onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                placeholder="MM/YY"
                maxLength={5}
                className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                CVV
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={cardCvv}
                onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="•••"
                className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Name on Card
            </label>
            <input
              type="text"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="Juan dela Cruz"
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      )}

      {/* Promo code */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-bold text-[#111827] flex items-center gap-2"><Tag className="w-4 h-4 text-[#FDF0D5]" /> Promo Code</p>
        {promo ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-bold text-green-700">{promo.code} applied</p>
              <p className="text-xs text-green-600">Saving ₱{discount.toLocaleString()} on this booking</p>
            </div>
            <button onClick={removePromo} className="text-green-500 hover:text-green-700 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={promoInput}
                onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoError('') }}
                placeholder="Enter promo code"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
              />
              <button
                onClick={applyPromo}
                disabled={!promoInput.trim() || promoChecking}
                className="px-4 py-2.5 bg-[#FDF0D5] hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm rounded-xl transition-colors"
              >
                {promoChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
              </button>
            </div>
            {promoError && <p className="text-xs text-red-500">{promoError}</p>}
            <p className="text-xs text-gray-400">Try: RENTIVO10, WELCOME15, CREATOR20</p>
          </>
        )}
      </div>

      {/* Terms */}
      <label className="flex items-start gap-3 cursor-pointer">
        <div
          onClick={() => setAgreed((v) => !v)}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
            agreed ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'
          }`}
        >
          {agreed && <Check className="w-3 h-3 text-white" />}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          I agree to the{' '}
          <a href="#" className="text-[#003049] underline">Rental Agreement</a>,{' '}
          <a href="#" className="text-[#003049] underline">Terms of Service</a>, and{' '}
          <a href="#" className="text-[#003049] underline">Cancellation Policy</a>. I understand the security deposit of{' '}
          <strong>₱{listing.security_deposit.toLocaleString()}</strong> is refundable upon return.
        </p>
      </label>

      {/* Payment error */}
      {payError && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {payError}
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={handlePay}
          disabled={!canPay || loading}
          className="flex-1 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" />
              Pay ₱{total.toLocaleString()}
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-center text-gray-400 flex items-center justify-center gap-1">
        <Lock className="w-3 h-3" /> Payments secured by PayMongo
      </p>
    </div>
  )
}
