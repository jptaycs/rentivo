'use client'

import { useState } from 'react'
import { StepIndicator } from './StepIndicator'
import { OrderSummary } from './OrderSummary'
import { Step1Review } from './Step1Review'
import { Step2Pickup } from './Step2Pickup'
import { Step3Payment } from './Step3Payment'
import { Step4Confirmation } from './Step4Confirmation'
import type { Listing } from '@/types'

type PaymentMethod = 'gcash' | 'maya' | 'card' | 'apple_pay' | 'google_pay'

interface BookingWizardProps {
  listing: Listing
  pickupDate: string
  returnDate: string
  days: number
}

function generateRef() {
  return 'RNT-' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

export function BookingWizard({ listing, pickupDate, returnDate, days }: BookingWizardProps) {
  const [step, setStep] = useState(0)
  const [isDelivery, setIsDelivery] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('gcash')
  const [bookingRef] = useState(generateRef)

  const goNext = () => setStep((s) => Math.min(s + 1, 3))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  function handlePaymentComplete(method: PaymentMethod) {
    setPaymentMethod(method)
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
            <Step3Payment
              listing={listing}
              days={days}
              onNext={handlePaymentComplete}
              onBack={goBack}
            />
          )}
          {step === 3 && (
            <Step4Confirmation
              listing={listing}
              pickupDate={pickupDate}
              returnDate={returnDate}
              days={days}
              isDelivery={isDelivery}
              paymentMethod={paymentMethod}
              bookingRef={bookingRef}
            />
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
