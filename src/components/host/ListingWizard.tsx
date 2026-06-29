'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye } from 'lucide-react'
import { WizardStep } from './WizardStep'
import { Step1Photos } from './Step1Photos'
import { Step2Details } from './Step2Details'
import { Step3Pricing } from './Step3Pricing'
import { Step4Calendar } from './Step4Calendar'
import { Step5Address } from './Step5Address'
import { Step6Verify } from './Step6Verify'

interface WizardState {
  images: string[]
  details: { category: string; brand: string; model: string; serialNumber: string; condition: string; description: string; accessories: string[] }
  pricing: { dailyPrice: string; weeklyPrice: string; monthlyPrice: string; securityDeposit: string }
  blockedDates: string[]
  address: { streetAddress: string; city: string; province: string; isInstantBook: boolean }
}

const INITIAL: WizardState = {
  images: [],
  details: { category: '', brand: '', model: '', serialNumber: '', condition: '', description: '', accessories: [] },
  pricing: { dailyPrice: '', weeklyPrice: '', monthlyPrice: '', securityDeposit: '' },
  blockedDates: [],
  address: { streetAddress: '', city: '', province: '', isInstantBook: false },
}

export function ListingWizard() {
  const [step, setStep] = useState(1)
  const [state, setState] = useState<WizardState>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [listingId] = useState('1') // will be real ID from Supabase insert

  const next = () => setStep(s => Math.min(s + 1, 6))
  const back = () => setStep(s => Math.max(s - 1, 1))

  async function handleSubmit() {
    setLoading(true)
    // TODO: insert into Supabase listings table with state data
    await new Promise(r => setTimeout(r, 1800))
    setLoading(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="text-center space-y-6 py-10">
        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10 text-[#22C55E]" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-[#111827]">Listing submitted!</h2>
          <p className="text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
            Your listing is under review. We'll verify your details and activate it within <strong>24 hours</strong>. You'll get an email once it's live.
          </p>
        </div>

        <div className="bg-[#F8FAFC] rounded-2xl border border-gray-100 p-6 max-w-sm mx-auto space-y-3 text-left">
          <p className="text-sm font-bold text-[#111827] mb-3">What happens next?</p>
          {[
            'Rentivo reviews your identity documents',
            'Your listing goes live within 24 hours',
            'Renters can find and book your gear',
            'You get paid within 2 days of return',
          ].map((s, i) => (
            <div key={i} className="flex gap-3 text-sm text-gray-600">
              <span className="w-5 h-5 rounded-full bg-[#003049] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              {s}
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={`/listings/${listingId}`}
            className="flex items-center justify-center gap-2 border border-[#003049] text-[#003049] font-bold py-3 px-6 rounded-xl text-sm hover:bg-blue-50 transition-colors">
            <Eye className="w-4 h-4" /> Preview Listing
          </Link>
          <Link href="/dashboard/listings"
            className="flex items-center justify-center bg-[#003049] text-white font-bold py-3 px-6 rounded-xl text-sm hover:bg-[#002438] transition-colors">
            Go to My Listings
          </Link>
        </div>
        <Link href="/" className="text-sm text-gray-400 hover:text-[#003049] transition-colors block">← Back to Home</Link>
      </div>
    )
  }

  return (
    <>
      <WizardStep current={step} />

      {step === 1 && (
        <Step1Photos
          images={state.images}
          onChange={images => setState(s => ({ ...s, images }))}
          onNext={next}
        />
      )}
      {step === 2 && (
        <Step2Details
          data={state.details}
          onChange={details => setState(s => ({ ...s, details }))}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 3 && (
        <Step3Pricing
          data={state.pricing}
          onChange={pricing => setState(s => ({ ...s, pricing }))}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 4 && (
        <Step4Calendar
          blockedDates={state.blockedDates}
          onChange={blockedDates => setState(s => ({ ...s, blockedDates }))}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 5 && (
        <Step5Address
          data={state.address}
          onChange={address => setState(s => ({ ...s, address }))}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 6 && (
        <Step6Verify
          onSubmit={handleSubmit}
          onBack={back}
          loading={loading}
        />
      )}
    </>
  )
}
