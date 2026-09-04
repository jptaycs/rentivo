'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, Lock, Loader2, Check, Tag, X, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/useUser'
import { calcPricing } from '@/lib/pricing'
import { enabledPaymentMethods, isPaymentMethodDisabled } from '@/lib/payment-methods'
import type { Listing } from '@/types'

type PaymentMethod = 'gcash' | 'maya' | 'card' | 'qrph' | 'apple_pay' | 'google_pay' | 'host_qr'

export interface CheckoutPayload {
  method: PaymentMethod
  phone?: string
  promoCode?: string
  paymentMethodId?: string
}

interface Step3PaymentProps {
  listing: Listing
  days: number
  isDelivery: boolean
  onNext: (payload: CheckoutPayload) => Promise<void>
  onBack: () => void
}

interface AppliedPromo {
  code: string
  pct: number | null
  flat: number | null
}

const PAYMONGO_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY

// PayMongo activates payment methods per-merchant after KYB review. Methods
// listed here render disabled with a "Coming soon" badge rather than failing at
// attach time. That label is deliberately the same one Apple/Google Pay carry:
// a renter only needs to know the method isn't selectable yet, and splitting the
// copy into "Unavailable" vs "Coming soon" just read as two kinds of broken.
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
  { id: 'apple_pay', label: 'Apple Pay', logo: '/logos/apple-pay.svg', color: 'border-gray-900', comingSoon: true },
  { id: 'google_pay', label: 'Google Pay', logo: '/logos/google-pay.svg', color: 'border-gray-300', comingSoon: true },
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
  // This default can never be 'host_qr' (it's not in enabledPaymentMethods()).
  // Selecting 'host_qr' only ever happens by clicking the tile — but the tile
  // renders OPTIMISTICALLY (hostDelinquent below starts false, before the
  // delinquency RPC resolves), so a user CAN select it in that window even if
  // the host turns out delinquent a moment later. Harmless either way: the
  // database trigger is the real enforcement, regardless of what the client
  // believed when the tile was clicked.
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
  const [promo, setPromo] = useState<AppliedPromo | null>(null)
  const [promoInput, setPromoInput] = useState('')
  const [promoError, setPromoError] = useState('')
  const [promoChecking, setPromoChecking] = useState(false)

  // Withhold the direct-QR tile while the host has an overdue commission bill
  // (host commission billing, 061). The database trigger refuses such a
  // booking anyway; this just never shows an option that would be refused.
  // is_host_billing_delinquent is anon-callable and security definer, but
  // unlike is_host_suspended on /dashboard/rentals (which fails SAFE — an
  // RPC error is treated as suspended), this check fails OPEN: `.then(({data})
  // => ...)` ignores `error`, so an unanswerable call leaves `data`
  // undefined, `Boolean(undefined)` is false, and the tile stays visible.
  // Acceptable here — this is a UX nicety, not the enforcement; the trigger
  // blocks the actual booking server-side regardless of what this client
  // believes.
  const [hostDelinquent, setHostDelinquent] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!listing.host?.qr_payment_url) return
    createClient()
      .rpc('is_host_billing_delinquent', { p_host_id: listing.host_id })
      .then(({ data }) => {
        if (!cancelled) setHostDelinquent(Boolean(data))
      })
    return () => {
      cancelled = true
    }
  }, [listing.host_id, listing.host?.qr_payment_url])

  // hostDelinquent starts false, so hasHostQr can only ever go true -> false
  // once the RPC resolves, never false -> true after a flash of the tile.
  const hasHostQr = Boolean(listing.host?.qr_payment_url) && !hostDelinquent
  const methods = (hasHostQr
    ? [...BASE_METHODS, { id: 'host_qr' as const, label: 'GCash/Maya QR (Direct to Host)', logo: '', color: 'border-purple-400', comingSoon: false, unavailable: false }]
    : BASE_METHODS
  ).map((m) => (isPaymentMethodDisabled(m.id) ? { ...m, comingSoon: true, unavailable: true } : m))

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

  const { rentalFee, total: baseTotal } = calcPricing(listing, days, isDelivery)
  // Discount applies to the rental fee only — never the refundable deposit
  const discount = promo
    ? Math.min(rentalFee, Math.round((rentalFee * (promo.pct ?? 0)) / 100) + (promo.flat ?? 0))
    : 0
  const total = baseTotal - discount

  const isWallet = method === 'gcash' || method === 'maya'
  const isCard = method === 'card'
  const isHostQr = method === 'host_qr'
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
      isHostQr ||
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

      {/* Host QR notice */}
      {isHostQr && (
        <div className="bg-purple-50 rounded-2xl border border-purple-200 p-5 space-y-2">
          <p className="text-sm font-bold text-[#111827]">GCash/Maya QR — paid directly to the host</p>
          {/* Deliberately generic: the host's payment label is their real name +
              mobile number, so it's only shown once the booking exists (fetched
              from the party-scoped /api/bookings/[id]/qr route), never to someone
              merely browsing checkout. */}
          <p className="text-sm text-purple-800">
            You&apos;ll pay ₱{total.toLocaleString()}{' '}directly to the host via GCash/Maya QR. Rentivo
            doesn&apos;t process or hold this payment; your host will confirm they&apos;ve received it.
            Your host&apos;s payment details and QR code will be shown once your booking is created.
          </p>
        </div>
      )}

      {/* Promo code */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-bold text-[#111827] flex items-center gap-2"><Tag className="w-4 h-4 text-[#003049]" /> Promo Code</p>
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
                className="px-4 py-2.5 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm rounded-xl transition-colors"
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
          ) : isHostQr ? (
            <>
              <Lock className="w-4 h-4" />
              Create Booking
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" />
              Pay ₱{total.toLocaleString()}
            </>
          )}
        </button>
      </div>

      {/* PayMongo is never involved in the host-QR flow — claiming it is would be false */}
      {!isHostQr && (
        <p className="text-xs text-center text-gray-400 flex items-center justify-center gap-1">
          <Lock className="w-3 h-3" /> Payments secured by PayMongo
        </p>
      )}
    </div>
  )
}
