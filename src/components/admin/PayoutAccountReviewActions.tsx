'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PayoutAccountReviewActions({ accountId }: { accountId: string }) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function review(approve: boolean) {
    if (!approve && !confirm('Reject this payout account?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/payout-accounts/${accountId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, notes: notes || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Review failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Reviewer notes (optional)"
        className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => review(true)}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Verify Account'}
        </button>
        <button
          onClick={() => review(false)}
          disabled={busy}
          className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
