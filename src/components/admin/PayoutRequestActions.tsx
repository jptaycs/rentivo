'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PayoutRequestActions({ requestId, amount }: { requestId: string; amount: string }) {
  const router = useRouter()
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(path: 'paid' | 'failed', body: Record<string, string>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/payout-requests/${requestId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Action failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  function markPaid() {
    if (!reference.trim()) {
      setError('A payment reference is required to mark this paid.')
      return
    }
    if (!confirm(`Mark this ${amount} payout as PAID? Only do this after actually sending the money.`)) return
    post('paid', { reference: reference.trim() })
  }

  function markFailed() {
    if (!reason.trim()) {
      setError('A reason is required to mark this failed.')
      return
    }
    if (!confirm('Mark this payout as FAILED? Its bookings become eligible for a new request.')) return
    post('failed', { reason: reason.trim() })
  }

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Payment reference (required)"
          className="flex-1 rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
        />
        <button
          onClick={markPaid}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Mark Paid'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Failure reason (required)"
          className="flex-1 rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
        />
        <button
          onClick={markFailed}
          disabled={busy}
          className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
        >
          Mark Failed
        </button>
      </div>
    </div>
  )
}
