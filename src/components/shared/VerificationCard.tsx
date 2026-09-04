'use client'

import { useRef, useState } from 'react'
import { BadgeCheck, Upload, CheckCircle2, Clock, XCircle, Loader2, AlertCircle } from 'lucide-react'
import { useVerification } from '@/hooks/useVerification'
import { validateIdDocument, validateSelfie, type ValidationCode } from '@/lib/id-validation'

export function VerificationCard() {
  const { request, isVerified, loading, submit } = useVerification()
  const [idFile, setIdFile] = useState<File | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [idError, setIdError] = useState('')
  const [selfieError, setSelfieError] = useState('')
  // The real failing codes, so the submitted `auto_check_detail` records what
  // actually happened (e.g. `too_small`) instead of always claiming `no_face`.
  const [idCode, setIdCode] = useState<ValidationCode | null>(null)
  const [selfieCode, setSelfieCode] = useState<ValidationCode | null>(null)
  const [idAttempts, setIdAttempts] = useState(0)
  const [selfieAttempts, setSelfieAttempts] = useState(0)
  const [override, setOverride] = useState(false)
  const [checking, setChecking] = useState(false)
  // The detector could not run, so nothing was checked. Not an error the user
  // can fix, so it never blocks — but the submission must still be flagged.
  const [degraded, setDegraded] = useState(false)
  // Which tile is mid-check, purely for the visible spinner below — the
  // MediaPipe model is an 11.7 MB one-time download, so an unexplained
  // multi-second freeze on a slow connection reads as a broken upload.
  const [checkingKind, setCheckingKind] = useState<'id' | 'selfie' | null>(null)
  const idRef = useRef<HTMLInputElement>(null)
  const selfieRef = useRef<HTMLInputElement>(null)

  async function pick(kind: 'id' | 'selfie', file: File | null) {
    if (!file) return
    // Captured before the (possibly slow, model-download) check so the
    // override-reset comparison below reflects this slot's status going in,
    // not whatever it happens to be once the await resolves.
    const hadFail = kind === 'id' ? Boolean(idCode) : Boolean(selfieCode)
    setChecking(true)
    setCheckingKind(kind)
    const result = kind === 'id' ? await validateIdDocument(file) : await validateSelfie(file)
    setChecking(false)
    setCheckingKind(null)
    // Reset the override whenever this slot's failing status changes — this
    // component previously had no reset at all, so even a *pass* left a
    // stale tick armed to silently wave through a future, different failure.
    if (Boolean(!result.ok) !== hadFail) setOverride(false)
    if (result.ok) {
      if (result.degraded) setDegraded(true)
      if (kind === 'id') { setIdFile(file); setIdError(''); setIdCode(null) } else { setSelfieFile(file); setSelfieError(''); setSelfieCode(null) }
      return
    }
    // Keep the file so the override can still submit it after a second try.
    if (kind === 'id') { setIdFile(file); setIdError(result.reason); setIdCode(result.code); setIdAttempts((n) => n + 1) }
    else { setSelfieFile(file); setSelfieError(result.reason); setSelfieCode(result.code); setSelfieAttempts((n) => n + 1) }
  }

  const blocked = Boolean(idError || selfieError) && !override

  async function handleSubmit() {
    if (!idFile || !selfieFile || blocked) return
    setSubmitting(true)
    setError('')
    const failed = Boolean(idError || selfieError) || degraded
    const detail =
      [idCode && `id:${idCode}`, selfieCode && `selfie:${selfieCode}`, degraded && 'detector_unavailable']
        .filter(Boolean).join(',') || null
    const err = await submit(idFile, selfieFile, { failed, detail })
    if (err) setError(err)
    else {
      setIdFile(null); setSelfieFile(null)
      setIdError(''); setSelfieError('')
      setIdCode(null); setSelfieCode(null)
      setIdAttempts(0); setSelfieAttempts(0); setOverride(false); setDegraded(false)
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
            <input ref={idRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => {
                // Reset the input's own value first — per the HTML file-input
                // contract, re-selecting the *same* path otherwise fires no
                // `change` event, so retrying the same file after a
                // false-negative silently does nothing.
                const file = e.target.files?.[0] ?? null
                e.target.value = ''
                pick('id', file)
              }} />
            <button
              onClick={() => idRef.current?.click()}
              disabled={checking}
              className={`flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left disabled:cursor-wait ${
                checkingKind === 'id' ? 'border-gray-200 bg-gray-50'
                  : idError ? 'border-red-300 bg-red-50'
                  : idFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {checkingKind === 'id'
                ? <Loader2 className="w-5 h-5 text-gray-400 shrink-0 animate-spin" />
                : idError
                  ? <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                  : idFile ? <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" /> : <Upload className="w-5 h-5 text-gray-400 shrink-0" />}
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${checkingKind === 'id' ? 'text-gray-500' : idError ? 'text-red-600' : idFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {checkingKind === 'id' ? 'Checking your document…' : idFile ? idFile.name : 'Government ID'}
                </p>
                <p className="text-[10px] text-gray-400">JPG or PNG</p>
              </div>
            </button>

            <input ref={selfieRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                e.target.value = ''
                pick('selfie', file)
              }} />
            <button
              onClick={() => selfieRef.current?.click()}
              disabled={checking}
              className={`flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left disabled:cursor-wait ${
                checkingKind === 'selfie' ? 'border-gray-200 bg-gray-50'
                  : selfieError ? 'border-red-300 bg-red-50'
                  : selfieFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {checkingKind === 'selfie'
                ? <Loader2 className="w-5 h-5 text-gray-400 shrink-0 animate-spin" />
                : selfieError
                  ? <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                  : selfieFile ? <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" /> : <Upload className="w-5 h-5 text-gray-400 shrink-0" />}
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${checkingKind === 'selfie' ? 'text-gray-500' : selfieError ? 'text-red-600' : selfieFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {checkingKind === 'selfie' ? 'Checking your photo…' : selfieFile ? selfieFile.name : 'Selfie with ID'}
                </p>
                <p className="text-[10px] text-gray-400">Clear face + ID photo</p>
              </div>
            </button>
          </div>

          {(idError || selfieError) && (
            <div className="space-y-2">
              {idError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {idError}
                </div>
              )}
              {selfieError && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {selfieError}
                </div>
              )}
            </div>
          )}

          {/* The on-device check couldn't run — most often an older phone whose
              browser lacks WebAssembly SIMD, since the no-SIMD model build isn't
              vendored. The submission still goes through (and is flagged
              `detector_unavailable` for the reviewer), but saying nothing left
              the uploader believing their document had passed a check that
              never happened. Amber, not red: nothing is wrong with their photo. */}
          {degraded && !idError && !selfieError && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                We couldn&apos;t run the automatic photo check on this device — your
                documents will go straight to manual review instead. You can submit
                as normal.
              </span>
            </div>
          )}

          {(idAttempts >= 2 || selfieAttempts >= 2) && (idError || selfieError) && (
            <label className="flex items-start gap-3 cursor-pointer" onClick={() => setOverride(!override)}>
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${override ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'}`}>
                {override && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                My document is valid — submit for manual review anyway.
              </p>
            </label>
          )}

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!idFile || !selfieFile || submitting || blocked || checking}
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
