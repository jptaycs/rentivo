'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Props {
  userId: string
  name: string
  /** profiles.suspended_at is set. */
  isSuspended: boolean
  /**
   * The REAL GoTrue ban state, not profiles.suspended_at. The suspend route
   * flags the profile BEFORE banning, so a failed ban leaves suspended=true
   * with banned=false — a half-applied suspension. That state needs the
   * detail page's both-directions diagnosis (it is equally reachable from a
   * failed UN-suspend), so this component deliberately offers no inline
   * action for it and links out instead.
   */
  isBanned: boolean
  /** Allowlisted admin — the routes refuse to suspend or delete one. */
  isAdmin: boolean
}

type Mode = 'suspend' | 'delete' | null

export function RowActions({ userId, name, isSuspended, isBanned, isAdmin }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')

  function close() {
    setMode(null)
    setError(null)
    setReason('')
    setConfirmText('')
  }

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
      close()
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  // Never render a button that is guaranteed to 403 — both routes refuse an
  // allowlisted admin, including the acting admin themselves.
  if (isAdmin) return <span className="text-xs text-gray-400">Admin</span>

  // Half-applied: flagged but not banned (or the reverse). Recovering needs the
  // detail page, which names both possible causes and offers both directions.
  if (isSuspended && !isBanned) {
    return (
      <Link
        href={`/admin/users/${userId}`}
        className="text-xs font-semibold text-amber-700 hover:underline"
      >
        Needs attention
      </Link>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {isSuspended ? (
          <button
            type="button"
            onClick={() => post('unsuspend')}
            disabled={busy}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Un-suspend'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode('suspend')}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Suspend
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode('delete')}
          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      {/* Suspend — the route 400s without a written reason, and the reason is
          what lands in the admin_actions audit row and the user's email. */}
      <Dialog open={mode === 'suspend'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="bg-white p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#111827]">Suspend {name || 'this user'}</DialogTitle>
            <DialogDescription>
              Blocks their login, hides their listings from the marketplace, and stops payouts.
              The reason is recorded in the audit log and sent to them by email.
            </DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            aria-label="Reason for suspension"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this account being suspended?"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#003049] focus:outline-none"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => post('suspend', { reason: reason.trim() })}
              disabled={busy || !reason.trim()}
              className="rounded-xl bg-[#003049] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Confirm suspend'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete — typing DELETE is what stops the wrong row being clicked in a
          long table. The route runs its own eligibility gates on top. */}
      <Dialog open={mode === 'delete'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="bg-white p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#111827]">Delete {name || 'this user'}</DialogTitle>
            <DialogDescription>
              Anonymizes the profile and blocks login. Refused if they have an in-flight booking,
              a pending payout, or an unpaid commission bill. Type DELETE to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            aria-label="Type DELETE to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm focus:border-[#003049] focus:outline-none"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => post('delete', { confirm: confirmText })}
              disabled={busy || confirmText !== 'DELETE'}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Delete account'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
