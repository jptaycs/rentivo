'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, QrCode, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
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
}

export function BookingWizard({ listing, pickupDate, returnDate, days }: BookingWizardProps) {
  const [step, setStep] = useState(0)
  const [isDelivery, setIsDelivery] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [booking, setBooking] = useState<Booking | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [qrWaiting, setQrWaiting] = useState<{ image: string; bookingId: string } | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyNote, setVerifyNote] = useState('')

  const goNext = () => setStep((s) => Math.min(s + 1, 3))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

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

    if (payload.method === 'host_qr') {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('create_booking', {
        p_listing_id: listing.id,
        p_pickup_date: pickupDate,
        p_return_date: returnDate,
        p_is_delivery: isDelivery,
        p_delivery_address: isDelivery ? deliveryAddress : null,
        p_payment_method: 'host_qr',
        p_promo_code: payload.promoCode || null,
      })
      if (rpcError) {
        setError(rpcError.message.replace(/^.*?: /, ''))
        return
      }
      const created = data as Booking
      setBooking(created)
      fetch(`/api/bookings/${created.id}/notify-qr-requested`, { method: 'POST' }).catch((e) =>
        console.error('[email] notify-qr-requested failed', e)
      )
      goNext()
      return
    }

    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId: listing.id,
        pickupDate,
        returnDate,
        isDelivery,
        deliveryAddress: isDelivery ? deliveryAddress : null,
        bookingId,
        ...payload,
      }),
    })

    let data: {
      status?: 'paid' | 'redirect' | 'qr'
      url?: string
      qrImage?: string
      booking?: Booking
      bookingId?: string
      error?: string
    }
    try {
      data = await res.json()
    } catch {
      setError('Something went wrong while processing your payment. Please try again.')
      return
    }

    // Keep the unpaid booking so a retry doesn't create a duplicate
    if (data.bookingId) setBookingId(data.bookingId)

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
              onDeliveryChange={setIsDelivery}
              onAddressChange={setDeliveryAddress}
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
                isDelivery={step >= 1 ? isDelivery : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
