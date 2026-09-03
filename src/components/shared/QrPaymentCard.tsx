'use client'

import { useEffect, useRef, useState } from 'react'
import { QrCode, Upload, CheckCircle2, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'

export function QrPaymentCard() {
  const { profile, loading, uploadQrCode, removeQrCode } = useProfile()
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!profile?.qr_payment_url) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset preview when the profile's QR is cleared/changed; no test suite to safely verify a rewrite (see AGENTS.md)
      setPreviewUrl(null)
      return
    }
    const supabase = createClient()
    supabase.storage
      .from('payment-qr-codes')
      .createSignedUrl(profile.qr_payment_url, 300)
      .then(({ data }) => setPreviewUrl(data?.signedUrl ?? null))
  }, [profile?.qr_payment_url])

  async function handleSubmit() {
    if (!file || !label.trim()) return
    setSubmitting(true)
    setError('')
    const err = await uploadQrCode(file, label.trim())
    if (err) setError(err)
    else {
      setFile(null)
      setLabel('')
    }
    setSubmitting(false)
  }

  async function handleRemove() {
    setRemoving(true)
    setError('')
    const err = await removeQrCode()
    if (err) setError(err)
    setRemoving(false)
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <QrCode className="w-5 h-5 text-[#003049]" />
        <h2 className="font-bold text-[#111827]">GCash/Maya Payment QR</h2>
      </div>

      <p className="text-sm text-gray-500">
        Upload your personal GCash or Maya &quot;receive money&quot; QR code to let renters pay you
        directly at checkout, bypassing PayMongo. Rentivo never processes or holds this money —
        you&apos;ll confirm receipt yourself once a renter pays.
      </p>

      <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
        Bookings paid through your QR are billed the 5% service fee monthly.{' '}
        <a href="/host-terms" target="_blank" rel="noreferrer" className="underline">See Host Terms</a>.
      </p>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
        </div>
      ) : profile?.qr_payment_url ? (
        <div className="flex items-center gap-4 p-4 bg-green-50 border border-green-100 rounded-xl">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket, not a next/image remotePattern candidate
            <img src={previewUrl} alt="Your payment QR" className="w-16 h-16 rounded-lg object-cover shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-700">QR code uploaded</p>
            <p className="text-xs text-gray-500 truncate">{profile.qr_payment_label}</p>
          </div>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept="image/*" className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => fileRef.current?.click()}
            className={`w-full flex items-center gap-3 p-3 border-2 rounded-xl transition-all text-left ${
              file ? 'border-[#22C55E] bg-green-50' : 'border-dashed border-gray-200 hover:border-[#003049] hover:bg-gray-50'
            }`}
          >
            {file ? <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" /> : <Upload className="w-5 h-5 text-gray-400 shrink-0" />}
            <div className="min-w-0">
              <p className={`text-xs font-semibold truncate ${file ? 'text-[#22C55E]' : 'text-gray-700'}`}>
                {file ? file.name : 'Upload QR code image'}
              </p>
              <p className="text-[10px] text-gray-400">JPG, PNG, WEBP</p>
            </div>
          </button>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Label (shown to renters)
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="GCash — Juan Dela Cruz, 09XX XXX XXXX"
              className="w-full text-sm border border-gray-200 rounded-xl px-4 py-2.5 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!file || !label.trim() || submitting}
            className="flex items-center gap-2 bg-[#003049] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            Save QR Code
          </button>
        </div>
      )}
    </section>
  )
}
