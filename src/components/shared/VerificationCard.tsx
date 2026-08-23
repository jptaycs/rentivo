'use client'

import { useRef, useState } from 'react'
import { BadgeCheck, Upload, CheckCircle2, Clock, XCircle, Loader2, AlertCircle } from 'lucide-react'
import { useVerification } from '@/hooks/useVerification'

export function VerificationCard() {
  const { request, isVerified, loading, submit } = useVerification()
  const [idFile, setIdFile] = useState<File | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const idRef = useRef<HTMLInputElement>(null)
  const selfieRef = useRef<HTMLInputElement>(null)

  async function handleSubmit() {
    if (!idFile || !selfieFile) return
    setSubmitting(true)
    setError('')
    const err = await submit(idFile, selfieFile)
    if (err) setError(err)
    else {
      setIdFile(null)
      setSelfieFile(null)
    }
    setSubmitting(false)
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BadgeCheck className="w-5 h-5 text-[#003049]" />
        <h2 className="font-bold text-[#111827]">Identity Verification</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
        </div>
      ) : isVerified ? (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-100 rounded-xl">
          <BadgeCheck className="w-6 h-6 text-[#22C55E] shrink-0" />
          <p className="text-sm font-semibold text-green-700">You&apos;re verified. A badge now shows on your profile and listings.</p>
        </div>
      ) : request?.status === 'pending' ? (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
          <Clock className="w-6 h-6 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold text-amber-700">Your documents are under review.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">
            Verify your identity to earn a trust badge — required to build confidence with renters or hosts. Documents are private and never shown publicly.
          </p>

          {request?.status === 'rejected' && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700">Your last submission wasn&apos;t approved.</p>
                {request.reviewer_notes && <p className="text-xs text-red-500 mt-0.5">{request.reviewer_notes}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input ref={idRef} type="file" accept="image/*,.pdf" className="sr-only"
              onChange={(e) => setIdFile(e.target.files?.[0] ?? null)} />
            <button
              onClick={() => idRef.current?.click()}
              className={`flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left ${
                idFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {idFile ? <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" /> : <Upload className="w-5 h-5 text-gray-400 shrink-0" />}
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${idFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {idFile ? idFile.name : 'Government ID'}
                </p>
                <p className="text-[10px] text-gray-400">JPG, PNG, PDF</p>
              </div>
            </button>

            <input ref={selfieRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)} />
            <button
              onClick={() => selfieRef.current?.click()}
              className={`flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left ${
                selfieFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {selfieFile ? <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" /> : <Upload className="w-5 h-5 text-gray-400 shrink-0" />}
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${selfieFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {selfieFile ? selfieFile.name : 'Selfie with ID'}
                </p>
                <p className="text-[10px] text-gray-400">Clear face + ID photo</p>
              </div>
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!idFile || !selfieFile || submitting}
            className="flex items-center gap-2 bg-[#003049] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
            Submit for Verification
          </button>
        </>
      )}
    </section>
  )
}
