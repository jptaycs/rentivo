'use client'

import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
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

  const goNext = () => setStep((s) => Math.min(s + 1, 3))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

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
        bookingId,
        ...payload,
      }),
    })

    let data: {
      status?: 'paid' | 'redirect'
      url?: string
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
              <Step3Payment
                listing={listing}
                days={days}
                onNext={handlePaymentComplete}
                onBack={goBack}
              />
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
