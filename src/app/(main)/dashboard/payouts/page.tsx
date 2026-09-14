'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Landmark, Plus, CheckCircle2, Clock, AlertCircle, XCircle, ChevronRight } from 'lucide-react'
import { usePayoutAccount } from '@/hooks/usePayoutAccount'
import { usePayoutRequests } from '@/hooks/usePayoutRequests'
import { usePayoutBalance } from '@/hooks/usePayoutBalance'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { MOCK_PAYOUT_REQUESTS } from '@/lib/mock-data'
import { SummaryCardSkeleton, DashboardRowsSkeleton } from '@/components/shared/Skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import type { PayoutAccount } from '@/types'

const PAYOUT_METHODS: PayoutAccount['method'][] = [
  'GCash', 'Maya', 'Bank Transfer (Instapay)', 'BDO', 'BPI', 'UnionBank',
]

const MOCK_ACCOUNT: PayoutAccount = {
  id: 'p1', user_id: 'mock', method: 'GCash', account_number: '09171234567',
  account_name: 'Juan P. Tayco', status: 'verified', reviewer_notes: null,
  created_at: '2026-06-01', reviewed_at: '2026-06-02',
}

const MOCK_BALANCE = { bookings: 3, amount: 32250 }

function mask(number: string) {
  return `•••• ${number.slice(-4)}`
}

const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`

function historyDate(value: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value)
  return d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
}

function StatusPill({ status }: { status: PayoutAccount['status'] }) {
  if (status === 'verified') {
    return (
      <span className="text-xs bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" /> Verified
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
        <XCircle className="w-3 h-3" /> Rejected
      </span>
    )
  }
  return (
    <span className="text-xs bg-yellow-100 text-yellow-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
      <Clock className="w-3 h-3" /> Under review
    </span>
  )
}

export default function PayoutsPage() {
  const live = isSupabaseConfigured()
  const { account, loading: accountLoading, setPayoutAccount } = usePayoutAccount()
  const { requests, loading: requestsLoading } = usePayoutRequests()
  const { bookings: balanceBookings, amount: balanceAmount, loading: balanceLoading, error: balanceError } =
    usePayoutBalance()

  const [formOpen, setFormOpen] = useState(false)
  const [method, setMethod] = useState<PayoutAccount['method'] | ''>('')
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const displayAccount = live ? account : MOCK_ACCOUNT
  const displayBalance = live
    ? { bookings: balanceBookings, amount: balanceAmount }
    : MOCK_BALANCE
  // A cancelled draft (failed, never reversed) is hidden: the host was never
  // told it existed and never received anything for it.
  const displayRequests = (live ? requests : MOCK_PAYOUT_REQUESTS).filter(
    (r) => !(r.status === 'failed' && !r.reversed_at)
  )
  const loading = live && (accountLoading || requestsLoading || balanceLoading)

  async function handleAdd() {
    if (!method || !number || !name) return
    setSubmitting(true)
    setAccountError(null)
    const err = await setPayoutAccount({ method, accountNumber: number, accountName: name })
    setSubmitting(false)
    if (err) {
      setAccountError(err)
      return
    }
    setFormOpen(false)
    setMethod('')
    setNumber('')
    setName('')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Payouts</h1>
        <p className="text-gray-500 text-sm mt-1">Manage where you receive your earnings</p>
      </div>

      {loading ? (
        <div className="space-y-8">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <SummaryCardSkeleton />
          <DashboardRowsSkeleton rows={3} />
        </div>
      ) : (
        <>
          {/* Owed to you. Payouts are admin-issued — there is deliberately no
              button here: a host doesn't ask for one. */}
          <div className="bg-gradient-to-br from-[#003049] to-blue-700 rounded-2xl p-6 text-white">
            <p className="text-sm font-medium opacity-80">Owed to you</p>
            {balanceError && live ? (
              <>
                <p className="text-2xl font-bold mt-1">Couldn&apos;t load your balance</p>
                <p className="text-sm opacity-80 mt-1">{balanceError}</p>
              </>
            ) : (
              <>
                <p className="text-4xl font-bold mt-1">{fmt(displayBalance.amount)}</p>
                <p className="text-sm opacity-70 mt-1">
                  {displayBalance.bookings === 1
                    ? 'From 1 completed rental'
                    : `From ${displayBalance.bookings} completed rentals`}
                </p>
              </>
            )}
            <p className="mt-4 text-sm opacity-80">
              Rentivo pays out completed rentals to your verified account — you don&apos;t need to request it.
            </p>
          </div>

          {/* Payout account */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-bold text-[#111827]">Payout Account</p>
              {!formOpen && (
                <button onClick={() => setFormOpen(true)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#003049] hover:text-blue-700 transition-colors">
                  <Plus className="w-4 h-4" /> {displayAccount ? 'Replace account' : 'Add account'}
                </button>
              )}
            </div>

            {displayAccount && (
              <div className="flex items-center gap-4 p-4 bg-[#F8FAFC] rounded-xl border border-gray-100">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <Landmark className="w-5 h-5 text-[#003049]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-[#111827]">{displayAccount.method} {mask(displayAccount.account_number)}</p>
                  <p className="text-xs text-gray-400">{displayAccount.account_name}</p>
                  {displayAccount.status === 'rejected' && displayAccount.reviewer_notes && (
                    <p className="text-xs text-red-500 mt-1">{displayAccount.reviewer_notes}</p>
                  )}
                </div>
                <StatusPill status={displayAccount.status} />
              </div>
            )}

            {/* Add/replace account form */}
            {formOpen && (
              <div className="border border-[#003049]/30 rounded-xl p-5 space-y-4 bg-blue-50/30">
                <p className="font-bold text-sm text-[#111827]">{displayAccount ? 'Replace' : 'Add'} Payout Account</p>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Payment Method</label>
                  <select value={method} onChange={e => setMethod(e.target.value as PayoutAccount['method'])}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#003049] bg-white">
                    <option value="">Select method</option>
                    {PAYOUT_METHODS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Mobile Number / Account Number</label>
                  <input value={number} onChange={e => setNumber(e.target.value)}
                    placeholder="e.g. 09171234567"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#003049] bg-white" />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Account Name</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="Name as registered"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#003049] bg-white" />
                </div>

                {accountError && <p className="text-sm text-red-600">{accountError}</p>}

                <div className="flex gap-2">
                  <button onClick={() => { setFormOpen(false); setAccountError(null) }}
                    className="flex-1 border border-gray-200 rounded-xl py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleAdd} disabled={!method || !number || !name || submitting}
                    className="flex-1 bg-[#003049] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors">
                    {submitting ? 'Saving…' : (displayAccount ? 'Replace Account' : 'Add Account')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-gray-400 pt-1">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              New accounts go through a 24-hour verification before they can receive payouts.
            </div>
          </div>

          {/* Payout history */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <p className="font-bold text-[#111827] mb-4">Payout Statements</p>
            {displayRequests.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No payouts yet.</p>
            ) : (
              <div className="space-y-3">
                {displayRequests.map(req => {
                  const reversed = req.status === 'failed' && Boolean(req.reversed_at)
                  const draft = req.status === 'pending'

                  const row = (
                    <>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        reversed ? 'bg-red-50' : draft ? 'bg-yellow-50' : 'bg-green-50'
                      }`}>
                        {reversed ? (
                          <XCircle className="w-4 h-4 text-red-500" />
                        ) : draft ? (
                          <Clock className="w-4 h-4 text-yellow-600" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {draft ? (
                          <>
                            <p className="text-sm font-semibold text-[#111827]">
                              Being prepared — {fmt(req.amount)}
                            </p>
                            <p className="text-xs text-gray-400">
                              We&apos;ll send you a statement once the transfer is made.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-[#111827] flex items-center gap-2 flex-wrap">
                              <span className="tracking-wider">{req.statement_number}</span>
                              <span className="text-gray-400 font-normal">·</span>
                              <span>{fmt(req.amount)}</span>
                              {reversed && (
                                <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                  Reversed
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400">
                              {req.transferred_on ? historyDate(req.transferred_on) : historyDate(req.requested_at)}
                              {req.reference ? ` · ${req.reference}` : ''}
                            </p>
                            {reversed && req.reversal_reason && (
                              <p className="text-xs text-red-600 mt-0.5">{req.reversal_reason}</p>
                            )}
                          </>
                        )}
                      </div>
                      {!draft && <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />}
                    </>
                  )

                  // A draft has no statement number, so there is no document to
                  // open yet — it isn't a link.
                  return draft ? (
                    <div key={req.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                      {row}
                    </div>
                  ) : (
                    <Link
                      key={req.id}
                      href={`/dashboard/payouts/${req.id}`}
                      className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/70 -mx-2 px-2 rounded-xl transition-colors"
                    >
                      {row}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
