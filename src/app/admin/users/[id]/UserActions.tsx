'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DeletionBlocker } from '@/lib/account-deletion'

interface Props {
  userId: string
  isSuspended: boolean
  /** null when checkDeletionEligibility couldn't run at all (e.g. bad id) —
   *  treated the same as blocked, since there's nothing to show as eligible. */
  eligible: boolean
  reason: string | null
  blocking: DeletionBlocker
}

export function UserActions({ userId, isSuspended, eligible, reason, blocking }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showSuspendForm, setShowSuspendForm] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')

  const [confirmText, setConfirmText] = useState('')

  async function post(path: string, body?: object) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Request failed.')
        return
      }
      router.refresh()
      setShowSuspendForm(false)
      setSuspendReason('')
      setConfirmText('')
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  const blockingLines: string[] = []
  if (blocking.bookings.length > 0) {
    blockingLines.push(
      `${blocking.bookings.length} in-flight booking${blocking.bookings.length === 1 ? '' : 's'} (${blocking.bookings.join(', ')})`
    )
  }
  if (blocking.pendingPayouts > 0) {
    blockingLines.push(
      `${blocking.pendingPayouts} pending payout request${blocking.pendingPayouts === 1 ? '' : 's'}`
    )
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-bold text-gray-900">Actions</h2>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {/* Suspend / Un-suspend */}
      {isSuspended ? (
        <button
          onClick={() => post('unsuspend')}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Un-suspend'}
        </button>
      ) : (
        <div>
          {!showSuspendForm ? (
            <button
              onClick={() => setShowSuspendForm(true)}
              disabled={busy}
              className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
            >
              Suspend
            </button>
          ) : (
            <div className="rounded-xl border border-gray-200 p-4">
              <label className="mb-2 block text-xs font-semibold text-gray-500">
                Reason (required — shown in the audit log and emailed to the user)
              </label>
              <textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
                placeholder="Why is this account being suspended?"
              />
              {!suspendReason.trim() && (
                <p className="mt-1 text-xs text-gray-400">A reason is required to suspend.</p>
              )}
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => post('suspend', { reason: suspendReason.trim() })}
                  disabled={busy || !suspendReason.trim()}
                  className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Working…' : 'Confirm suspend'}
                </button>
                <button
                  onClick={() => {
                    setShowSuspendForm(false)
                    setSuspendReason('')
                    setError(null)
                  }}
                  disabled={busy}
                  className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete */}
      <div className="mt-6 border-t border-gray-100 pt-6">
        <h3 className="mb-2 text-sm font-bold text-gray-900">Delete account</h3>
        {!eligible ? (
          <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            Blocked
            {blockingLines.length > 0 ? ` — ${blockingLines.join('; ')}.` : `: ${reason ?? 'could not check eligibility.'}`}
            {' '}Resolve {blockingLines.length > 0 ? 'it' : 'this'} first, or suspend this account instead
            (suspension is always allowed).
          </p>
        ) : (
          <div>
            <p className="mb-2 text-xs text-gray-500">
              This anonymizes the profile and blocks login. Type <span className="font-mono font-semibold">DELETE</span> to confirm.
            </p>
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-red-400 focus:outline-none"
              />
              <button
                onClick={() => post('delete', { confirm: confirmText })}
                disabled={busy || confirmText !== 'DELETE'}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Delete account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
