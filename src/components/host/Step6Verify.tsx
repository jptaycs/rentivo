'use client'

import { useRef, useState } from 'react'
import { ChevronLeft, Loader2, CheckCircle2, Upload, BadgeCheck, Shield, Clock, XCircle, AlertCircle } from 'lucide-react'
import { useVerification } from '@/hooks/useVerification'
import { validateIdDocument, validateSelfie, messageForCode, type ValidationCode } from '@/lib/id-validation'

export interface VerifyData {
  idFile: File | null
  selfieFile: File | null
  agreed: boolean
  // Verdict lives here, not in component-local state, so it shares the file's
  // lifetime — Step6Verify unmounts/remounts on every Back→Next in the wizard
  // (see ListingWizard's `{step === 6 && <Step6Verify …/>}`), and a verdict
  // that reset to "no error" on remount while the failing file was still
  // attached used to render a green check mark over a submission that had
  // actually failed, and then overwrite the correct `autoCheckFailed: true`
  // with `false` the next time either tile was touched.
  idCode: ValidationCode | null
  selfieCode: ValidationCode | null
  degraded: boolean
  autoCheckFailed: boolean
  autoCheckDetail: string | null
  // Also lifted out of component-local state for the same Back→Next
  // unmount/remount reason as the verdict fields above — otherwise a host who
  // failed twice, ticked the override, and went Back to check something comes
  // back with the error still showing but the counters (and the override
  // itself) reset to zero, hard-locking them out of their own escape hatch.
  idAttempts: number
  selfieAttempts: number
  override: boolean
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

  const [checking, setChecking] = useState(false)
  // Which tile is mid-check, purely for the visible spinner — the on-device
  // face model is an 11.7 MB one-time download, so an unexplained
  // multi-second freeze on a slow connection reads as a broken upload.
  const [checkingKind, setCheckingKind] = useState<'id' | 'selfie' | null>(null)

  // Latest `data` behind a ref: `pick()` awaits a slow (model-download) check,
  // and closing over the `data` prop directly means the write after that await
  // merges into a stale pre-check snapshot — silently reverting anything the
  // user changed (e.g. ticking the agreement box) while the check was running.
  // Assigned directly in the render body (not a useEffect) so it's never a
  // single-digit-ms tick stale — a `Back` click during that window could
  // otherwise race an in-flight check's resolution and revert to the ref's
  // pre-Back snapshot.
  const dataRef = useRef(data)
  // eslint-disable-next-line react-hooks/refs -- deliberate write-only sync in render (not a useEffect), so an in-flight async pick() can never resolve against a stale pre-Back snapshot; see comment above.
  dataRef.current = data

  const idError = data.idCode ? messageForCode('id', data.idCode) : ''
  const selfieError = data.selfieCode ? messageForCode('selfie', data.selfieCode) : ''

  function set<K extends keyof VerifyData>(key: K, value: VerifyData[K]) {
    onChange({ ...dataRef.current, [key]: value })
  }

  async function pick(kind: 'id' | 'selfie', file: File | null) {
    if (!file) return
    setChecking(true)
    setCheckingKind(kind)
    const result = kind === 'id' ? await validateIdDocument(file) : await validateSelfie(file)
    setChecking(false)
    setCheckingKind(null)

    const current = dataRef.current
    const code = result.ok ? null : result.code
    const hadFail = kind === 'id' ? Boolean(current.idCode) : Boolean(current.selfieCode)
    const nowFail = Boolean(code)

    const idCode = kind === 'id' ? code : current.idCode
    const selfieCode = kind === 'selfie' ? code : current.selfieCode
    const idAttempts = kind === 'id' && code ? current.idAttempts + 1 : current.idAttempts
    const selfieAttempts = kind === 'selfie' && code ? current.selfieAttempts + 1 : current.selfieAttempts
    const degradedNow = current.degraded || Boolean(result.ok && result.degraded)
    const failedNow = Boolean(idCode) || Boolean(selfieCode) || degradedNow
    const detailNow = [
      idCode && `id:${idCode}`,
      selfieCode && `selfie:${selfieCode}`,
      degradedNow && 'detector_unavailable',
    ].filter(Boolean).join(',') || null
    // Reset the override whenever this slot's failing status *changes* — not
    // only on a pass. Otherwise an override ticked for a twice-failed ID stays
    // armed the moment a selfie fails for the first time, silently skipping
    // that slot's own two-strike requirement.
    const override = nowFail !== hadFail ? false : current.override

    onChange({
      ...current,
      [kind === 'id' ? 'idFile' : 'selfieFile']: file,
      idCode,
      selfieCode,
      idAttempts,
      selfieAttempts,
      degraded: degradedNow,
      autoCheckFailed: failedNow,
      autoCheckDetail: detailNow,
      override,
    })
  }

  // Already verified, or a review is already in flight — nothing to upload
  const alreadyHandled = isVerified || request?.status === 'pending'
  const blocked = Boolean(idError || selfieError) && !data.override
  const canSubmit = alreadyHandled
    ? data.agreed
    : Boolean(data.idFile && data.selfieFile && data.agreed) && !blocked && !checking

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
          <p className="text-sm font-semibold text-green-700">You&apos;re already verified — no need to resubmit.</p>
        </div>
      ) : request?.status === 'pending' ? (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
          <Clock className="w-6 h-6 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold text-amber-700">Your documents are under review. We&apos;ll notify you once verified.</p>
        </div>
      ) : (
        <>
          {request?.status === 'rejected' && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
              <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">Your last submission wasn&apos;t approved.</p>
                {request.reviewer_notes && <p className="text-xs text-red-500 mt-0.5">{request.reviewer_notes}</p>}
                <p className="text-xs text-red-500 mt-0.5">Please upload clearer documents below to try again.</p>
              </div>
            </div>
          )}

          {/* Government ID */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Government-Issued ID</p>
            <input ref={idRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => {
                // Reset the input's own value first — per the HTML file-input
                // contract, re-selecting the *same* path otherwise fires no
                // `change` event at all, so retrying the same file after a
                // false-negative silently does nothing (no spinner, no new
                // attempt counted, no path to the override).
                const file = e.target.files?.[0] ?? null
                e.target.value = ''
                pick('id', file)
              }} />
            <button
              onClick={() => idRef.current?.click()}
              disabled={checking}
              className={`w-full flex items-center gap-4 p-4 border-2 rounded-xl transition-all disabled:cursor-wait ${
                checkingKind === 'id' ? 'border-gray-200 bg-gray-50'
                  : idError ? 'border-red-300 bg-red-50'
                  : data.idFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {checkingKind === 'id'
                ? <Loader2 className="w-6 h-6 text-gray-400 shrink-0 animate-spin" />
                : idError
                  ? <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
                  : data.idFile ? <CheckCircle2 className="w-6 h-6 text-[#22C55E] shrink-0" /> : <Upload className="w-6 h-6 text-gray-400 shrink-0" />}
              <div className="text-left">
                <p className={`text-sm font-semibold ${checkingKind === 'id' ? 'text-gray-500' : idError ? 'text-red-600' : data.idFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {checkingKind === 'id' ? 'Checking your document…' : data.idFile ? data.idFile.name : 'Upload government ID'}
                </p>
                <p className="text-xs text-gray-400">Passport, Driver&apos;s License, or PhilSys ID · JPG or PNG</p>
              </div>
            </button>
          </div>

          {/* Selfie */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Selfie with ID</p>
            <input ref={selfieRef} type="file" accept="image/*" className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                e.target.value = ''
                pick('selfie', file)
              }} />
            <button
              onClick={() => selfieRef.current?.click()}
              disabled={checking}
              className={`w-full flex items-center gap-4 p-4 border-2 rounded-xl transition-all disabled:cursor-wait ${
                checkingKind === 'selfie' ? 'border-gray-200 bg-gray-50'
                  : selfieError ? 'border-red-300 bg-red-50'
                  : data.selfieFile ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
              }`}
            >
              {checkingKind === 'selfie'
                ? <Loader2 className="w-6 h-6 text-gray-400 shrink-0 animate-spin" />
                : selfieError
                  ? <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
                  : data.selfieFile ? <CheckCircle2 className="w-6 h-6 text-[#22C55E] shrink-0" /> : <Upload className="w-6 h-6 text-gray-400 shrink-0" />}
              <div className="text-left">
                <p className={`text-sm font-semibold ${checkingKind === 'selfie' ? 'text-gray-500' : selfieError ? 'text-red-600' : data.selfieFile ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                  {checkingKind === 'selfie' ? 'Checking your photo…' : data.selfieFile ? data.selfieFile.name : 'Upload selfie holding your ID'}
                </p>
                <p className="text-xs text-gray-400">Clear photo of your face and the front of your ID</p>
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

          {(data.idAttempts >= 2 || data.selfieAttempts >= 2) && (idError || selfieError) && (
            <label className="flex items-start gap-3 cursor-pointer" onClick={() => set('override', !data.override)}>
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${data.override ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'}`}>
                {data.override && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                My document is valid — submit for manual review anyway.
              </p>
            </label>
          )}
        </>
      )}

      {/* Host agreement */}
      <label className="flex items-start gap-3 cursor-pointer" onClick={() => set('agreed', !data.agreed)}>
        <div
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${data.agreed ? 'bg-[#003049] border-[#003049]' : 'border-gray-300'}`}
        >
          {data.agreed && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          I confirm that this equipment belongs to me, the information provided is accurate, and I agree to Rentivo&apos;s{' '}
          <a href="/host-terms" target="_blank" rel="noreferrer" className="text-[#003049] hover:underline">Host Terms of Service</a> and{' '}
          <a href="#" className="text-[#003049] hover:underline">Equipment Listing Policy</a>.
        </p>
      </label>

      <div className="flex gap-3">
        {/* Disabled during `checking` too, not just `loading`: a Back click mid
            check would let an in-flight, stale-mount check resolve after the
            remount and clobber whatever the new mount's user just changed. */}
        <button onClick={onBack} disabled={loading || checking}
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
