'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'

/**
 * Reverse an issued statement.
 *
 * ⚠️ Reversing releases the statement's bookings, so the host is owed that
 * money again — if the transfer actually arrived, the host can end up paid
 * twice. The database cannot know whether it arrived, so the safeguard is the
 * admin's own attention: they must type the statement number back and give a
 * reason. The typed number is checked again on the server; the disabled button
 * here is a courtesy, not the gate.
 */
export function ReverseStatementAction({
  requestId,
  statementNumber,
  amountLabel,
}: {
  requestId: string
  statementNumber: string
  amountLabel: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = typed.trim() === statementNumber
  const canSubmit = matches && reason.trim() !== '' && !busy

  async function submit() {
    setError(null)
    if (!canSubmit) return
    if (
      !confirm(
        `Reverse ${statementNumber} (${amountLabel})? The bookings it covered become owed again. ` +
          'If the transfer really arrived, this host can be paid for them twice.'
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/payout-statements/${requestId}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), confirmStatementNumber: typed.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'The reversal failed.')
        return
      }
      if (json.emailed === false) {
        setError('Reversed, but the notification email was not sent. Use Resend below.')
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600"
      >
        Reverse this statement
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <p className="flex items-start gap-2 text-sm font-bold text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Reversing releases this statement&apos;s bookings — {amountLabel} becomes owed to this host again.
      </p>
      <p className="mt-1.5 text-xs text-red-700/90">
        Rentivo has no way to know whether the transfer arrived. If it did and you reverse this anyway, the
        host will be paid for the same rentals twice. The statement keeps its number either way.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="reverse-reason" className="mb-1 block text-xs font-medium text-red-900">
            Reason (required — the host sees this)
          </label>
          <textarea
            id="reverse-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Why is this payout being reversed?"
            className="w-full rounded-xl border border-red-200 bg-white p-3 text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="reverse-confirm" className="mb-1 block text-xs font-medium text-red-900">
            Type <span className="font-mono font-bold">{statementNumber}</span> to confirm
          </label>
          <input
            id="reverse-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={statementNumber}
            className="w-64 rounded-xl border border-red-200 bg-white p-3 font-mono text-sm focus:border-[#003049] focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Reversing…' : 'Reverse statement'}
          </button>
          <button
            onClick={() => {
              setOpen(false)
              setError(null)
            }}
            className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-600"
          >
            Keep it
          </button>
        </div>
      </div>
    </div>
  )
}
