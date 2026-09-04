'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BillVoidAction({ billId, amount, hasPaymentAttempt }: { billId: string; amount: string; hasPaymentAttempt?: boolean }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [waive, setWaive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function voidBill() {
    if (!reason.trim()) { setError('A reason is required to void a bill.'); return }
    const message =
      (waive
        ? `Void this ${amount} bill? This bill will be voided and its bookings will NOT be billed again.`
        : `Void this ${amount} bill? This bill will be voided and its bookings will become billable again on the next run.`) +
      (hasPaymentAttempt
        ? ' This bill has an active payment QR — if the host pays it after voiding, that payment will not be recorded automatically.'
        : '')
    if (!confirm(message)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bills/${billId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), rebill: !waive }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Void failed.'); return }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} className="h-3.5 w-3.5" />
        Waive — don&apos;t bill these bookings again
      </label>
      <button type="button" onClick={voidBill} disabled={busy} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50">Void</button>
    </div>
  )
}
