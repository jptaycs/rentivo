'use client'

import { useState } from 'react'
import { ChevronLeft, Lock, Loader2, Check, AlertCircle } from 'lucide-react'
import { useUser } from '@/hooks/useUser'
import { calcPricing } from '@/lib/pricing'
import { enabledPaymentMethods, isPaymentMethodDisabled } from '@/lib/payment-methods'
import type { Listing } from '@/types'

type PaymentMethod = 'gcash' | 'maya' | 'card' | 'qrph' | 'apple_pay' | 'google_pay'

export interface CheckoutPayload {
  method: PaymentMethod
  phone?: string
  paymentMethodId?: string
}

interface Step3PaymentProps {
  listing: Listing
  days: number
  isDelivery: boolean
  onNext: (payload: CheckoutPayload) => Promise<void>
  onBack: () => void
}

const PAYMONGO_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY

// PayMongo activates payment methods per-merchant after KYB review. Methods
// listed in NEXT_PUBLIC_DISABLED_PAYMENT_METHODS render disabled rather than
// failing at attach time, so a renter learns the method isn't selectable
// before they commit to it rather than after.
// Clearing the env var re-enables them, but note NEXT_PUBLIC_* is inlined at
// build time, so it needs a rebuild and redeploy — not just an env edit.
// The list itself lives in src/lib/payment-methods.ts so the checkout route
// enforces the same thing server-side.

const BASE_METHODS: {
  id: PaymentMethod
  label: string
  logo: string
  color: string
  comingSoon?: boolean
  unavailable?: boolean
}[] = [
  { id: 'gcash', label: 'GCash', logo: '/logos/gcash.svg', color: 'border-blue-400' },
  { id: 'maya', label: 'Maya', logo: '/logos/maya.svg', color: 'border-green-400' },
  { id: 'card', label: 'Credit / Debit Card', logo: '/logos/card.svg', color: 'border-gray-300' },
  { id: 'qrph', label: 'QR Ph', logo: '/logos/qrph.svg', color: 'border-teal-400' },
  // NOTE: the Apple Pay and Google Pay tiles were removed — they had sat here
  // as permanently disabled "Coming soon" placeholders for methods nothing in
  // this codebase implements, so they advertised choices a renter could never
  // make. The payment_method enum keeps both values (dropping one is a
  // migration) and Step4Confirmation still labels them, so any historical
  // booking carrying one still renders correctly.
  // NOTE: the pre-launch 'test_skip' ("Skip Payment") tile was removed at
  // launch — it marked a booking paid with no real charge, which would let any
  // signed-in user take equipment for free. The enum value and its payout
  // exclusion (032/033) deliberately remain so the bookings created while it
  // existed still render and stay ineligible for payout.
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

export function Step3Payment({ listing, days, isDelivery, onNext, onBack }: Step3PaymentProps) {
  const { user } = useUser()
  const [method, setMethod] = useState<PaymentMethod>(
    () => enabledPaymentMethods()[0] ?? 'qrph'
  )
  const [mobileNumber, setMobileNumber] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardName, setCardName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [payError, setPayError] = useState('')

  const methods = BASE_METHODS.map((m) =>
    isPaymentMethodDisabled(m.id) ? { ...m, comingSoon: true, unavailable: true } : m
  )

  // 071: promo codes are discontinued. A discount reduced what the renter paid
  // but not what the host was paid (request_payout pays rental_fee, stored
  // pre-discount), so every code cost Rentivo more than its 5% service fee.
  const { total } = calcPricing(listing, days, isDelivery)

  const isWallet = method === 'gcash' || method === 'maya'
  const isCard = method === 'card'
  const isQrph = method === 'qrph'

  const canPay =
    agreed &&
    // The selected method must actually be available. The initial state above
    // falls back to 'qrph' when enabledPaymentMethods() is empty, so without
    // this a fully-disabled list (a PayMongo outage, say) would select a
    // tile rendered "Unavailable" and still let Pay submit — the checkout
    // route would then reject it with a 400 the renter can't act on.
    !isPaymentMethodDisabled(method) &&
    ((isWallet && mobileNumber.replace(/\D/g, '').length === 11) ||
      (isCard && cardNumber.replace(/\s/g, '').length === 16 && cardExpiry && cardCvv.length >= 3 && cardName) ||
      isQrph)

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
          {methods.map((m) => (
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

      {/* QR Ph notice */}
      {isQrph && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2">
          <p className="text-sm font-bold text-[#111827]">Pay with QR Ph</p>
          <p className="text-xs text-gray-400">
            After you click Pay, we&apos;ll show a QR code — scan it with any QR Ph-enabled bank or e-wallet
            app to complete the payment. Rentivo processes this payment, same as GCash, Maya, or Card.
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

      {/* Terms */}
      <label className="flex items-start gap-3 cursor-pointer" onClick={() => setAgreed((v) => !v)}>
        <div
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
            agreed ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'
          }`}
        >
          {agreed && <Check className="w-3 h-3 text-white" />}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          I agree to the{' '}
          <a href="/rental-agreement" className="text-[#003049] underline">Rental Agreement</a>,{' '}
          <a href="/terms" className="text-[#003049] underline">Terms of Service</a>, and{' '}
          <a href="/refunds" className="text-[#003049] underline">Return and Refund Policy</a>. I understand this host asks for a{' '}
          <strong>₱{listing.security_deposit.toLocaleString()}</strong> security deposit, arranged directly with them at pickup and not charged by Rentivo.
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
