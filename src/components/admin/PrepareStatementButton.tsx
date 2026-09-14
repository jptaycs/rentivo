'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Prepare a draft statement for one host.
 *
 * `amount` is posted back as `expectedAmount` — the figure rendered in the row
 * the admin is looking at. If a booking completed between that render and this
 * click, create_payout_statement refuses and names both numbers, instead of
 * quietly drafting a different total than the admin approved.
 */
export function PrepareStatementButton({
  hostId,
  hostName,
  amount,
  amountLabel,
  disabled,
}: {
  hostId: string
  hostName: string
  amount: number
  amountLabel: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (
      !confirm(
        `Prepare a payout statement for ${hostName} covering ${amountLabel}? ` +
          'This fixes the bookings and the account details you must transfer to. No money moves yet.'
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/payout-statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, expectedAmount: amount }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not prepare the statement.')
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
    <div>
      <button
        onClick={submit}
        disabled={disabled || busy}
        className="rounded-xl bg-[#003049] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Preparing…' : 'Prepare statement'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
