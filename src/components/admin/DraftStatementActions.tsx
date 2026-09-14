'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The two things an admin can do with a draft: record the transfer they just
 * made, or throw the draft away.
 *
 * Recording is the irreversible half — it permanently consumes a gapless
 * statement number and emails the host — so it asks for the reference of the
 * real transfer and the date it actually happened, and confirms in words.
 * Cancelling is safe (no number is consumed, the bookings become owed again)
 * but still needs a reason, which is written to admin_actions.
 */
export function DraftStatementActions({
  requestId,
  amountLabel,
  todayManila,
  minDate,
}: {
  requestId: string
  amountLabel: string
  /** Today in Asia/Manila — the RPC refuses a transfer date in the future. */
  todayManila: string
  /** The Manila date the draft was prepared — the RPC refuses anything earlier. */
  minDate: string
}) {
  const router = useRouter()
  const [reference, setReference] = useState('')
  const [transferredOn, setTransferredOn] = useState(todayManila)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(path: 'issue' | 'cancel', body: Record<string, string>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/payout-statements/${requestId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Action failed.')
        return
      }
      if (path === 'issue' && json.emailed === false) {
        // Not an error — the transfer IS recorded. Say it plainly instead of
        // letting a silent failure look like a delivered email.
        setError('Recorded, but the statement email was not sent. Use Resend on the statement page.')
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  function recordTransfer() {
    if (!reference.trim()) {
      setError('A transfer reference is required.')
      return
    }
    if (!transferredOn) {
      setError('A transfer date is required.')
      return
    }
    if (
      !confirm(
        `Record a ${amountLabel} transfer on ${transferredOn}? ` +
          'Only do this after actually sending the money — it issues a numbered statement and emails the host.'
      )
    ) {
      return
    }
    post('issue', { reference: reference.trim(), transferredOn })
  }

  function cancelDraft() {
    if (!reason.trim()) {
      setError('A reason is required to cancel this draft.')
      return
    }
    if (!confirm('Cancel this draft? Its bookings go back to being owed, and no number is used.')) return
    post('cancel', { reason: reason.trim() })
  }

  return (
    <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor={`reference-${requestId}`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Transfer reference
          </label>
          <input
            id={`reference-${requestId}`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
            placeholder="e.g. GCash ref 1234567890"
            className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor={`transferred-${requestId}`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Transfer date
          </label>
          <input
            id={`transferred-${requestId}`}
            type="date"
            value={transferredOn}
            min={minDate}
            max={todayManila}
            onChange={(e) => setTransferredOn(e.target.value)}
            className="rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>
        <button
          onClick={recordTransfer}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Record transfer'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={`reason-${requestId}`} className="mb-1 block text-xs font-medium text-gray-700">
            Cancel reason
          </label>
          <input
            id={`reason-${requestId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Why is this draft being discarded?"
            className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>
        <button
          onClick={cancelDraft}
          disabled={busy}
          className="rounded-xl border border-red-200 px-5 py-3 text-sm font-semibold text-red-600 disabled:opacity-50"
        >
          Cancel draft
        </button>
      </div>
    </div>
  )
}
