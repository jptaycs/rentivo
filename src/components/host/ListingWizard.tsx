'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { WizardStep } from './WizardStep'
import { Step1Photos, type WizardPhoto } from './Step1Photos'
import { Step2Details } from './Step2Details'
import { Step3Pricing } from './Step3Pricing'
import { Step4Calendar } from './Step4Calendar'
import { Step5Address } from './Step5Address'
import { Step6Verify, type VerifyData } from './Step6Verify'

interface WizardState {
  photos: WizardPhoto[]
  details: { category: string; brand: string; model: string; serialNumber: string; condition: string; description: string; accessories: string[] }
  pricing: { dailyPrice: string; weeklyPrice: string; monthlyPrice: string; securityDeposit: string; deliveryFee: string }
  blockedDates: string[]
  address: { streetAddress: string; city: string; province: string; isInstantBook: boolean }
  verify: VerifyData
}

const INITIAL: WizardState = {
  photos: [],
  details: { category: '', brand: '', model: '', serialNumber: '', condition: '', description: '', accessories: [] },
  pricing: { dailyPrice: '', weeklyPrice: '', monthlyPrice: '', securityDeposit: '', deliveryFee: '' },
  blockedDates: [],
  address: { streetAddress: '', city: '', province: '', isInstantBook: false },
  verify: { idFile: null, selfieFile: null, agreed: false, idCode: null, selfieCode: null, degraded: false, autoCheckFailed: false, autoCheckDetail: null, idAttempts: 0, selfieAttempts: 0, override: false },
}

export function ListingWizard() {
  const [step, setStep] = useState(1)
  const [state, setState] = useState<WizardState>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [listingId, setListingId] = useState('')

  // Submit is resumable: a failure after the listing row exists must never
  // re-upload photos or insert a second listing. Refs (not state) so a retry
  // in the same mount always sees the latest values.
  const submittingRef = useRef(false)
  const listingIdRef = useRef<string | null>(null)
  // Keyed by name+size+lastModified, NOT by the File object. Re-picking the
  // same photo after a failed submit produces a brand-new File instance, so
  // object identity missed it and re-uploaded, stranding the first copy in the
  // bucket. Three matching attributes means the same file in every realistic
  // case; a collision would only reuse one of the host's own photos in their
  // own listing, which is cheaper than the leak it prevents.
  const uploadedImagesRef = useRef<Map<string, string>>(new Map())
  const photoKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`
  const [warning, setWarning] = useState('')
  const [hostVerified, setHostVerified] = useState(true)

  const next = () => setStep(s => Math.min(s + 1, 6))
  const back = () => setStep(s => Math.max(s - 1, 1))

  async function handleSubmit() {
    // setLoading is async, so two rapid clicks can both pass `disabled={loading}`
    // before React re-renders. The ref closes that window synchronously.
    if (submittingRef.current) return
    submittingRef.current = true
    setError('')
    setWarning('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('You must be signed in to create a listing.')

      const { data: hostProfile } = await supabase
        .from('profiles')
        .select('is_verified')
        .eq('id', user.id)
        .single()
      setHostVerified(Boolean(hostProfile?.is_verified))

      // Catch bad files before any write, so a bucket rejection can't strand
      // the submit halfway through.
      const MAX_BYTES = 10 * 1024 * 1024
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
      const toCheck: { file: File; what: string }[] = [
        ...state.photos.map(p => ({ file: p.file, what: 'photo' })),
        ...(state.verify.idFile ? [{ file: state.verify.idFile, what: 'ID document' }] : []),
        ...(state.verify.selfieFile ? [{ file: state.verify.selfieFile, what: 'selfie' }] : []),
      ]
      for (const { file, what } of toCheck) {
        if (!allowed.includes(file.type)) {
          throw new Error(`Your ${what} "${file.name}" is a ${file.type || 'unknown'} file. Use JPG, PNG, WebP, or AVIF.`)
        }
        if (file.size > MAX_BYTES) {
          throw new Error(`Your ${what} "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`)
        }
      }

      // Upload photos to the listing-images bucket (policy requires <uid>/ prefix)
      const imageUrls: string[] = []
      for (const { file } of state.photos) {
        // Already uploaded on an earlier attempt — reuse it rather than
        // orphaning a second copy in the bucket.
        const key = photoKey(file)
        const existing = uploadedImagesRef.current.get(key)
        if (existing) { imageUrls.push(existing); continue }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('listing-images')
          .upload(path, file, { contentType: file.type })
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`)
        const url = supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl
        uploadedImagesRef.current.set(key, url)
        imageUrls.push(url)
      }

      const { details, pricing, address } = state
      const fields = {
        host_id: user.id,
        category: details.category,
        brand: details.brand,
        model: details.model,
        title: `${details.brand} ${details.model}`.trim(),
        description: details.description,
        condition: details.condition,
        serial_number: details.serialNumber || null,
        daily_price: Number(pricing.dailyPrice),
        weekly_price: pricing.weeklyPrice ? Number(pricing.weeklyPrice) : null,
        monthly_price: pricing.monthlyPrice ? Number(pricing.monthlyPrice) : null,
        security_deposit: Number(pricing.securityDeposit || 0),
        delivery_fee: pricing.deliveryFee === '' ? null : Number(pricing.deliveryFee),
        city: address.city,
        province: address.province,
        street_address: address.streetAddress || null,
        is_instant_book: address.isInstantBook,
        images: imageUrls,
        accessories: details.accessories,
      }

      // The pivot: once a listing row exists for this submit, every retry
      // updates it. This is what makes a duplicate structurally impossible.
      if (listingIdRef.current) {
        const { error: updateError } = await supabase
          .from('listings')
          .update(fields)
          .eq('id', listingIdRef.current)
        if (updateError) throw new Error(`Could not update listing: ${updateError.message}`)
      } else {
        const { data: created, error: insertError } = await supabase
          .from('listings')
          .insert(fields)
          .select('id')
          .single()
        if (insertError) throw new Error(`Could not create listing: ${insertError.message}`)
        listingIdRef.current = created.id
      }
      const newListingId = listingIdRef.current as string

      // From here the listing row exists. A failure below must NOT send the
      // host back to a retry — that is exactly what produced duplicate
      // listings in production. Collect warnings and finish successfully.
      const warnings: string[] = []

      if (state.blockedDates.length > 0) {
        const { error: blockError } = await supabase.from('availability_blocks').insert(
          state.blockedDates.map(d => ({ listing_id: newListingId, blocked_on: d, reason: 'personal' }))
        )
        if (blockError) warnings.push('Your blocked dates could not be saved — set them again from the Calendar page.')
      }

      const { error: hostFlagError } = await supabase.from('profiles').update({ is_host: true }).eq('id', user.id)
      if (hostFlagError) warnings.push('Your host profile flag could not be updated. Contact support if your dashboard looks wrong.')

      // Identity verification — only if the host actually picked new files
      // (already-verified hosts, or ones with a submission already pending, skip this)
      if (state.verify.idFile && state.verify.selfieFile) {
        try {
          const idExt = state.verify.idFile.name.split('.').pop()?.toLowerCase() || 'jpg'
          const selfieExt = state.verify.selfieFile.name.split('.').pop()?.toLowerCase() || 'jpg'
          const idPath = `${user.id}/id-${Date.now()}.${idExt}`
          const selfiePath = `${user.id}/selfie-${Date.now()}.${selfieExt}`

          const { error: idUploadError } = await supabase.storage
            .from('verification-docs')
            .upload(idPath, state.verify.idFile, { contentType: state.verify.idFile.type })
          if (idUploadError) throw new Error(idUploadError.message)

          const { error: selfieUploadError } = await supabase.storage
            .from('verification-docs')
            .upload(selfiePath, state.verify.selfieFile, { contentType: state.verify.selfieFile.type })
          if (selfieUploadError) throw new Error(selfieUploadError.message)

          const { error: verifyInsertError } = await supabase.from('verification_requests').insert({
            user_id: user.id,
            id_doc_path: idPath,
            selfie_path: selfiePath,
            auto_check_failed: state.verify.autoCheckFailed,
            auto_check_detail: state.verify.autoCheckDetail,
          })
          if (verifyInsertError) throw new Error(verifyInsertError.message)
        } catch (verifyErr) {
          const detail = verifyErr instanceof Error ? verifyErr.message : 'unknown error'
          warnings.push(`Your listing was created, but the ID verification upload failed (${detail}). Retry it from Settings — your listing stays hidden until your ID is approved.`)
        }
      }

      setWarning(warnings.join(' '))
      setListingId(newListingId)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-6 py-10">
        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10 text-[#22C55E]" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-[#111827]">
            {hostVerified ? 'Your listing is live!' : 'Listing submitted!'}
          </h2>
          <p className="text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
            {hostVerified
              ? <>Your listing is now visible to renters. You can edit or pause it anytime from <strong>My Listings</strong>.</>
              : <>Your listing is saved but stays <strong>hidden</strong> until an admin approves your ID. It goes live automatically the moment that happens.</>}
          </p>
        </div>

        {warning && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm max-w-md mx-auto text-left">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {warning}
          </div>
        )}

        <div className="bg-[#F8FAFC] rounded-2xl border border-gray-100 p-6 max-w-sm mx-auto space-y-3 text-left">
          <p className="text-sm font-bold text-[#111827] mb-3">What happens next?</p>
          {(hostVerified
            ? [
                'Your listing is live and searchable now',
                'Renters can find and book your gear',
                'You approve or decline each booking request',
                'You get paid within 2 days of return',
              ]
            : [
                'An admin reviews your ID documents',
                'Your listing goes live as soon as it’s approved',
                'Renters can then find and book your gear',
                'You get paid within 2 days of return',
              ]
          ).map((s, i) => (
            <div key={i} className="flex gap-3 text-sm text-gray-600">
              <span className="w-5 h-5 rounded-full bg-[#003049] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              {s}
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {hostVerified && (
            <Link href={`/listings/${listingId}`}
              className="flex items-center justify-center gap-2 border border-[#003049] text-[#003049] font-bold py-3 px-6 rounded-xl text-sm hover:bg-blue-50 transition-colors">
              <Eye className="w-4 h-4" /> Preview Listing
            </Link>
          )}
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
          photos={state.photos}
          onChange={photos => setState(s => ({ ...s, photos }))}
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
        <>
          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          <Step6Verify
            data={state.verify}
            onChange={verify => setState(s => ({ ...s, verify }))}
            onSubmit={handleSubmit}
            onBack={back}
            loading={loading}
          />
        </>
      )}
    </>
  )
}
