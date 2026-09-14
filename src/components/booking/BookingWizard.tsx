'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, QrCode, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useDeliveryQuote } from '@/hooks/useDeliveryQuote'
import { canReuseBooking, isInPhilippines, roundPinCoord } from '@/lib/delivery-location'
import { calcPricing, storedBookingAmounts, type StoredBookingAmounts } from '@/lib/pricing'
import { StepIndicator } from './StepIndicator'
import { OrderSummary } from './OrderSummary'
import { Step1Review } from './Step1Review'
import { Step2Pickup } from './Step2Pickup'
import { Step3Payment, type CheckoutPayload } from './Step3Payment'
import { Step4Confirmation } from './Step4Confirmation'
import type { Listing, Booking } from '@/types'

interface BookingWizardProps {
  listing: Listing
  pickupDate: string
  returnDate: string
  days: number
  /** The live platform service-fee rate, read on the server (080/081). */
  serviceFeeBps: number
}

export function BookingWizard({ listing, pickupDate, returnDate, days, serviceFeeBps }: BookingWizardProps) {
  const [step, setStep] = useState(0)
  const [isDelivery, setIsDelivery] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  // 078: the renter's delivery pin, rounded to the numeric(10,7) the booking
  // stores, so the quoted, priced and stored coordinates are identical.
  const [deliveryPin, setDeliveryPin] = useState<{ lat: number; lng: number } | null>(null)
  const [booking, setBooking] = useState<Booking | null>(null)
  // The unpaid booking checkout created on an earlier attempt, as STORED. It is
  // only safe to reuse for a retry of the SAME delivery choice — and, for a
  // per-km delivery, the SAME pin — it was priced under: reusing it after
  // switching pickup↔delivery or moving the pin would charge the OLD total
  // (the old distance) and never persist the new choice. We keep what it was
  // created for (its stored is_delivery and pin) and derive reusability from
  // the current choice below, so changing either stops it being sent and
  // forces checkout to create a freshly priced one.
  const [storedBooking, setStoredBooking] = useState<StoredBookingAmounts | null>(null)
  const [error, setError] = useState('')
  const [qrWaiting, setQrWaiting] = useState<{ image: string; bookingId: string } | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyNote, setVerifyNote] = useState('')

  const goNext = () => setStep((s) => Math.min(s + 1, 3))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  // A previously created unpaid booking is only safe for checkout to reuse
  // when it was priced under the SAME pickup/delivery choice and the SAME pin
  // (compared at stored precision — canReuseBooking, shared with the route,
  // which enforces the same rule). Switching choice or moving the pin after a
  // failed/abandoned attempt must not silently charge the old total — so the
  // stale booking simply isn't reusable, and checkout creates (and correctly
  // prices) a fresh one. Retrying with the SAME choice and pin still reuses
  // it, so that path never creates a duplicate.
  const reusableBooking =
    storedBooking && canReuseBooking(storedBooking, isDelivery, isDelivery ? deliveryPin : null)
      ? storedBooking
      : null

  function handleDeliveryChange(next: boolean) {
    setIsDelivery(next)
  }

  function handlePinChange(p: { lat: number; lng: number }) {
    setDeliveryPin({ lat: roundPinCoord(p.lat), lng: roundPinCoord(p.lng) })
  }

  const perKmDelivery = isDelivery && listing.delivery_fee_per_km > 0
  const pinInPh = deliveryPin !== null && isInPhilippines(deliveryPin.lat, deliveryPin.lng)
  // Never quote a pin outside the Philippines (Step2Pickup shows why instead).
  const quote = useDeliveryQuote(listing.id, deliveryPin, perKmDelivery && pinInPh)

  // What the renter is shown. Once a reusable booking exists its STORED total
  // wins over the quote: that is the figure the payment intent is priced from.
  const quotedTotal = calcPricing(
    listing,
    days,
    serviceFeeBps,
    isDelivery,
    perKmDelivery && !quote.loading ? quote.fee : null
  ).total
  const displayTotal = reusableBooking ? reusableBooking.total_amount : quotedTotal

  // Poll while a QR Ph code is on screen — there's no redirect back to
  // confirm payment (unlike GCash/Maya/card), the customer stays right
  // here and scans with a separate app. The existing PayMongo webhook
  // is what actually flips payment_status; this just watches for that.
  useEffect(() => {
    if (!qrWaiting) return
    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', qrWaiting.bookingId)
        .single()
      if (data?.payment_status === 'paid') {
        clearInterval(interval)
        setQrWaiting(null)
        setBooking(data as Booking)
        goNext()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [qrWaiting])

  /**
   * Asks PayMongo directly whether this booking's intent has been paid,
   * rather than waiting on the webhook the poll above is watching for.
   * The route is idempotent, so an impatient renter tapping it repeatedly
   * is harmless.
   */
  async function handleVerifyPayment() {
    if (!qrWaiting) return
    setVerifying(true)
    setVerifyNote('')
    try {
      const res = await fetch(`/api/bookings/${qrWaiting.bookingId}/verify-payment`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyNote(data.error ?? 'Could not check the payment. Please try again.')
        return
      }
      if (data.status === 'paid') {
        const supabase = createClient()
        const { data: booked } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', qrWaiting.bookingId)
          .single()
        setQrWaiting(null)
        if (booked) setBooking(booked as Booking)
        goNext()
        return
      }
      setVerifyNote(
        data.status === 'processing'
          ? "Your payment is still processing — we'll confirm it here automatically."
          : "We haven't received this payment yet. If you've just paid, give it a few seconds and check again."
      )
    } catch {
      setVerifyNote('Network error — please try again.')
    } finally {
      setVerifying(false)
    }
  }

  async function handlePaymentComplete(payload: CheckoutPayload) {
    setError('')

    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId: listing.id,
        pickupDate,
        returnDate,
        isDelivery,
        deliveryAddress: isDelivery ? deliveryAddress : null,
        deliveryLat: perKmDelivery && deliveryPin ? deliveryPin.lat : null,
        deliveryLng: perKmDelivery && deliveryPin ? deliveryPin.lng : null,
        bookingId: reusableBooking?.id ?? null,
        // Not a price — lets the route stop before charging if the stored
        // total differs from what is on screen (see the route).
        expectedTotal: displayTotal,
        ...payload,
      }),
    })

    let data: {
      status?: 'paid' | 'redirect' | 'qr'
      url?: string
      qrImage?: string
      booking?: Booking
      bookingId?: string
      amounts?: StoredBookingAmounts
      error?: string
    }
    try {
      data = await res.json()
    } catch {
      setError('Something went wrong while processing your payment. Please try again.')
      return
    }

    // Keep the unpaid booking, as stored, so a retry doesn't create a
    // duplicate — but only for the delivery choice and pin it was priced
    // under (see reusableBooking, which stops reusing it if either changes).
    // Its stored amounts also become what the summary and Pay button show.
    if (data.amounts) {
      setStoredBooking(storedBookingAmounts(data.amounts))
    }

    if (!res.ok) {
      setError(data.error ?? 'Payment failed. Please try again.')
      return
    }
    if (data.status === 'redirect' && data.url) {
      window.location.assign(data.url)
      return
    }
    if (data.status === 'qr' && data.qrImage && data.bookingId) {
      setQrWaiting({ image: data.qrImage, bookingId: data.bookingId })
      return
    }
    setBooking(data.booking ?? null)
    goNext()
  }

  const showSummary = step < 3

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <StepIndicator current={step} />

      <div className={`flex flex-col gap-8 ${showSummary ? 'lg:flex-row' : ''}`}>
        {/* Step content */}
        <div className={showSummary ? 'flex-1 min-w-0' : 'w-full max-w-2xl mx-auto'}>
          {step === 0 && (
            <Step1Review
              listing={listing}
              pickupDate={pickupDate}
              returnDate={returnDate}
              days={days}
              onNext={goNext}
            />
          )}
          {step === 1 && (
            <Step2Pickup
              listing={listing}
              isDelivery={isDelivery}
              deliveryAddress={deliveryAddress}
              deliveryPin={deliveryPin}
              quote={quote}
              onDeliveryChange={handleDeliveryChange}
              onAddressChange={setDeliveryAddress}
              onPinChange={handlePinChange}
              onNext={goNext}
              onBack={goBack}
            />
          )}
          {step === 2 && (
            <>
              {error && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm mb-4">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
              {qrWaiting ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-4">
                  <QrCode className="w-6 h-6 text-teal-500 mx-auto" />
                  <h2 className="text-xl font-bold text-[#111827]">Scan to pay with QR Ph</h2>
                  {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URI from PayMongo, not a next/image remotePattern candidate */}
                  <img src={qrWaiting.image} alt="QR Ph payment code" className="w-56 h-56 mx-auto rounded-xl" />
                  {reusableBooking?.id === qrWaiting.bookingId && (
                    <p className="text-sm text-gray-600">
                      Amount: <span className="font-bold text-[#111827]">₱{reusableBooking.total_amount.toLocaleString()}</span>
                    </p>
                  )}
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Waiting for payment confirmation…
                  </div>

                  {/* Manual fallback: confirmation normally arrives via the
                      PayMongo webhook, which the poll above watches for. QR Ph
                      has no redirect-back pass to fall back on, so if that
                      webhook is delayed or missed a renter who really paid
                      would otherwise be stuck here indefinitely. */}
                  <div className="border-t border-gray-100 pt-4 space-y-2">
                    <p className="text-xs text-gray-400">
                      Already paid but still waiting? Confirmation can take a moment.
                    </p>
                    <button
                      onClick={handleVerifyPayment}
                      disabled={verifying}
                      className="w-full border border-[#003049] text-[#003049] hover:bg-[#F8FAFC] disabled:opacity-50 font-bold text-sm py-2.5 rounded-xl transition-colors"
                    >
                      {verifying ? 'Checking…' : "I've paid — check again"}
                    </button>
                    {verifyNote && <p className="text-xs text-gray-500">{verifyNote}</p>}
                  </div>

                  <button
                    onClick={() => setQrWaiting(null)}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-[#003049] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel and choose another method
                  </button>
                </div>
              ) : (
                <Step3Payment
                  listing={listing}
                  days={days}
                  serviceFeeBps={serviceFeeBps}
                  isDelivery={isDelivery}
                  totalOverride={displayTotal}
                  onNext={handlePaymentComplete}
                  onBack={goBack}
                />
              )}
            </>
          )}
          {step === 3 && booking && (
            <Step4Confirmation listing={listing} booking={booking} />
          )}
        </div>

        {/* Sticky order summary — hidden on confirmation step */}
        {showSummary && (
          <div className="lg:w-[360px] shrink-0">
            <div className="sticky top-24">
              <OrderSummary
                listing={listing}
                pickupDate={pickupDate}
                returnDate={returnDate}
                days={days}
                serviceFeeBps={serviceFeeBps}
                isDelivery={step >= 1 ? isDelivery : undefined}
                deliveryQuote={perKmDelivery ? quote : undefined}
                stored={step >= 1 ? reusableBooking : null}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
