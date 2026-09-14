'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'

/**
 * Send the host their statement email again — the recovery path when the send
 * at issue time failed. Which email goes out is decided on the server from the
 * row (statement or reversal notice), never from here.
 */
export function ResendStatementEmailButton({
  requestId,
  emailedAt,
}: {
  requestId: string
  emailedAt: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function submit() {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      const res = await fetch(`/api/admin/payout-statements/${requestId}/resend-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailed(true)
        setMessage(json.error ?? 'Could not send the email.')
        return
      }
      if (json.emailed) {
        setMessage('Email sent.')
        router.refresh()
      } else {
        setFailed(true)
        setMessage('The email was not sent. Check the server logs.')
      }
    } catch {
      setFailed(true)
      setMessage('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="no-print">
      <button
        onClick={submit}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
      >
        <Mail className="h-4 w-4" />
        {busy ? 'Sending…' : emailedAt ? 'Resend email' : 'Send email'}
      </button>
      {message && (
        <p
          role="status"
          className={`mt-2 text-xs ${failed ? 'text-red-600' : 'text-green-700'}`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
