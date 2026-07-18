'use client'

import { useRef } from 'react'
import { ChevronLeft, Loader2, CheckCircle2, Upload, BadgeCheck, Shield, Clock, XCircle } from 'lucide-react'
import { useVerification } from '@/hooks/useVerification'

export interface VerifyData {
  idFile: File | null
  selfieFile: File | null
  agreed: boolean
}

interface Step6VerifyProps {
  data: VerifyData
  onChange: (d: VerifyData) => void
  onSubmit: () => void
  onBack: () => void
  loading: boolean
}

export function Step6Verify({ data, onChange, onSubmit, onBack, loading }: Step6VerifyProps) {
  const { request, isVerified, loading: statusLoading } = useVerification()
  const idRef = useRef<HTMLInputElement>(null)
  const selfieRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof VerifyData>(key: K, value: VerifyData[K]) {
    onChange({ ...data, [key]: value })
  }

  // Already verified, or a review is already in flight — nothing to upload
  const alreadyHandled = isVerified || request?.status === 'pending'
  const canSubmit = alreadyHandled ? data.agreed : Boolean(data.idFile && data.selfieFile && data.agreed)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Identity verification</h2>
        <p className="text-gray-500 text-sm mt-1">Required to build trust with renters. Documents are stored securely and never shared publicly.</p>
      </div>

      {/* Why verify */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: BadgeCheck, title: 'Verified badge', desc: 'Get a blue badge on all your listings' },
          { icon: Shield, title: 'Higher earnings', desc: 'Verified hosts earn 40% more on average' },
          { icon: CheckCircle2, title: 'More trust', desc: 'Renters book verified hosts first' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-blue-50 rounded-xl p-4 text-center">
            <Icon className="w-6 h-6 text-[#003049] mx-auto mb-2" />
            <p className="text-sm font-bold text-[#111827]">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
          </div>
        ))}
      </div>

      {statusLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
        </div>
      ) : isVerified ? (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-100 rounded-xl">
          <BadgeCheck className="w-6 h-6 text-[#22C55E] shrink-0" />
          <p className="text-sm font-semibold text-green-700">You're already verified — no need to resubmit.</p>
        </div>
      ) : request?.status === 'pending' ? (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
          <Clock className="w-6 h-6 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold text-amber-700">Your documents are under review. We'll notify you once verified.</p>
        </div>
      ) : (
        <>
          {request?.status === 'rejected' && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
              <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">Your last submission wasn't approved.</p>
                {request.reviewer_notes && <p className="text-xs text-red-500 mt-0.5">{request.reviewer_notes}</p>}
                <p className="text-xs text-red-500 mt-0.5">Please upload clearer documents below to try again.</p>
              </div>
            </div>
          )}

          {/* Government ID */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Government-Issued ID</p>
            <input ref={idRef} type="file" accept="image/*,.pdf" className="sr-only"
              onChange={(e) => set('idFile', e.target.files?.[0] ?? null)} />
            <button
              onClick={() => idRef.current?.click()}
              className={`w-full flex items-center gap-4 p-4 border-2 rounded-xl transition-all ${
                data.idFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {data.idFile
                ? <CheckCircle2 className="w-6 h-6 text-[#22C55E] shrink-0" />
                : <Upload className="w-6 h-6 text-gray-400 shrink-0" />}
              <div className="text-left">
                <p className={`text-sm font-semibold ${data.idFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {data.idFile ? data.idFile.name : 'Upload government ID'}
                </p>
                <p className="text-xs text-gray-400">Passport, Driver's License, or PhilSys ID · JPG, PNG, PDF</p>
              </div>
            </button>
          </div>

          {/* Selfie */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Selfie with ID</p>
            <input ref={selfieRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => set('selfieFile', e.target.files?.[0] ?? null)} />
            <button
              onClick={() => selfieRef.current?.click()}
              className={`w-full flex items-center gap-4 p-4 border-2 rounded-xl transition-all ${
                data.selfieFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {data.selfieFile
                ? <CheckCircle2 className="w-6 h-6 text-[#22C55E] shrink-0" />
                : <Upload className="w-6 h-6 text-gray-400 shrink-0" />}
              <div className="text-left">
                <p className={`text-sm font-semibold ${data.selfieFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {data.selfieFile ? data.selfieFile.name : 'Upload selfie holding your ID'}
                </p>
                <p className="text-xs text-gray-400">Clear photo of your face and the front of your ID</p>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Host agreement */}
      <label className="flex items-start gap-3 cursor-pointer">
        <div
          onClick={() => set('agreed', !data.agreed)}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${data.agreed ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'}`}
        >
          {data.agreed && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          I confirm that this equipment belongs to me, the information provided is accurate, and I agree to Rentivo's{' '}
          <a href="#" className="text-[#003049] hover:underline">Host Terms of Service</a> and{' '}
          <a href="#" className="text-[#003049] hover:underline">Equipment Listing Policy</a>.
        </p>
      </label>

      <div className="flex gap-3">
        <button onClick={onBack} disabled={loading}
          className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit || loading}
          className="flex-1 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
            : <><BadgeCheck className="w-4 h-4" /> Submit Listing</>}
        </button>
      </div>
    </div>
  )
}
