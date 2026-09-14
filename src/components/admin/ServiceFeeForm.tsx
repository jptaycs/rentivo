'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatFeeRate, serviceFeeFor } from '@/lib/pricing'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

/** The rental the live preview prices, so the admin sees the consequence in money. */
const PREVIEW_RENTAL = 1000

/**
 * The admin-facing form for the platform service-fee rate.
 *
 * A percentage field and a Save button would not be enough for a number that
 * changes every listing's checkout the moment it commits, so this screen does
 * three things the plain form wouldn't:
 *  - shows the consequence in pesos BEFORE submitting (the live preview),
 *  - names both the old and the new rate in a confirm(),
 *  - requires a reason, which the RPC records in admin_actions.
 *
 * The field is a percentage because that is what an admin thinks in; the wire
 * and the database are basis points, so the conversion happens once, here, and
 * a value that does not round-trip is refused rather than silently rounded.
 */
export function ServiceFeeForm({ currentBps }: { currentBps: number }) {
  const router = useRouter()
  const [pct, setPct] = useState((currentBps / 100).toString())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pctNum = Number(pct)
  const pctValid = pct.trim() !== '' && Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 20
  // Math.round(x * 100) is the conversion; if dividing back does not give the
  // typed number, the admin entered more precision than basis points can hold.
  const nextBps = pctValid ? Math.round(pctNum * 100) : null
  const roundTrips = nextBps !== null && nextBps / 100 === pctNum
  const isNoop = nextBps === currentBps

  const canSubmit = pctValid && roundTrips && !isNoop && reason.trim() !== '' && !busy

  async function submit() {
    setError(null)
    if (!pctValid) {
      setError('Enter a percentage between 0 and 20.')
      return
    }
    if (!roundTrips || nextBps === null) {
      setError('Enter a percentage with at most two decimals.')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required.')
      return
    }
    if (isNoop) {
      setError('That is already the current rate.')
      return
    }
    if (
      !confirm(
        `Change Rentivo's service fee from ${formatFeeRate(currentBps)} to ${formatFeeRate(nextBps)}? ` +
          'Every booking made from now on is charged at the new rate.'
      )
    ) {
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings/service-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bps: nextBps, reason: reason.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'The change failed.')
        return
      }
      setReason('')
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">Change the service fee</h2>
      <p className="mt-1 text-sm text-gray-500">
        This takes effect immediately for every booking created after it. Bookings that already exist keep
        the rate they were charged at.
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="service-fee-pct" className="mb-1 block text-sm font-medium text-gray-700">
            New rate (%)
          </label>
          <input
            id="service-fee-pct"
            type="number"
            step="0.01"
            min="0"
            max="20"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-40 rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Up to two decimals. Current rate: {formatFeeRate(currentBps)}.
          </p>
        </div>

        <div>
          <label htmlFor="service-fee-reason" className="mb-1 block text-sm font-medium text-gray-700">
            Reason (required)
          </label>
          <textarea
            id="service-fee-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Why is the rate changing?"
            className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">Recorded in the history below.</p>
        </div>

        <div className="rounded-xl bg-[#F8FAFC] p-4 text-sm text-gray-700">
          {nextBps === null || !roundTrips ? (
            <span>Enter a valid percentage to preview the effect.</span>
          ) : (
            <span>
              On a {peso(PREVIEW_RENTAL)} rental the renter pays{' '}
              <strong>{peso(PREVIEW_RENTAL + serviceFeeFor(PREVIEW_RENTAL, currentBps))}</strong> now,{' '}
              <strong>{peso(PREVIEW_RENTAL + serviceFeeFor(PREVIEW_RENTAL, nextBps))}</strong> after.
            </span>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Change the rate'}
        </button>
        {isNoop && pctValid && roundTrips && (
          <p className="text-xs text-gray-500">That is already the current rate.</p>
        )}
      </div>
    </div>
  )
}
