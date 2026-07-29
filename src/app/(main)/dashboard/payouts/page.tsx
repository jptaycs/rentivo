'use client'

import { useState } from 'react'
import { Landmark, Plus, CheckCircle2, Clock, AlertCircle, XCircle, Loader2 } from 'lucide-react'
import { usePayoutAccount } from '@/hooks/usePayoutAccount'
import { usePayoutRequests } from '@/hooks/usePayoutRequests'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { PayoutAccount } from '@/types'

const PAYOUT_METHODS: PayoutAccount['method'][] = [
  'GCash', 'Maya', 'Bank Transfer (Instapay)', 'BDO', 'BPI', 'UnionBank',
]

const MOCK_ACCOUNT: PayoutAccount = {
  id: 'p1', user_id: 'mock', method: 'GCash', account_number: '09171234567',
  account_name: 'Juan P. Tayco', status: 'verified', reviewer_notes: null,
  created_at: '2026-06-01', reviewed_at: '2026-06-02',
}

const MOCK_BALANCE = 32250

function mask(number: string) {
  return `•••• ${number.slice(-4)}`
}

const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`

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
  const { requests, loading: requestsLoading, availableBalance, hasPendingRequest, requestPayout } = usePayoutRequests()

  const [formOpen, setFormOpen] = useState(false)
  const [method, setMethod] = useState<PayoutAccount['method'] | ''>('')
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const displayAccount = live ? account : MOCK_ACCOUNT
  const displayBalance = live ? availableBalance : MOCK_BALANCE
  const displayRequests = live ? requests : []
  const loading = live && (accountLoading || requestsLoading)

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

  async function handleRequestPayout() {
    setPayoutError(null)
    const err = await requestPayout()
    if (err) setPayoutError(err)
  }

  const canRequestPayout =
    live && !hasPendingRequest && displayAccount?.status === 'verified' && displayBalance > 0

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Payouts</h1>
        <p className="text-gray-500 text-sm mt-1">Manage where you receive your earnings</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <>
          {/* Payout balance */}
          <div className="bg-gradient-to-br from-[#003049] to-blue-700 rounded-2xl p-6 text-white">
            <p className="text-sm font-medium opacity-80">Available for payout</p>
            <p className="text-4xl font-bold mt-1">{fmt(displayBalance)}</p>
            <p className="text-sm opacity-70 mt-1">Processes within 1–2 business days</p>
            {live && hasPendingRequest ? (
              <p className="mt-4 text-sm font-semibold bg-white/10 inline-block px-4 py-2 rounded-xl">
                Payout requested — processing
              </p>
            ) : (
              <button
                onClick={handleRequestPayout}
                disabled={!canRequestPayout}
                className="mt-4 bg-white text-[#003049] font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Request Payout
              </button>
            )}
            {payoutError && <p className="mt-2 text-sm text-red-100">{payoutError}</p>}
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
            <p className="font-bold text-[#111827] mb-4">Payout History</p>
            {live && displayRequests.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No payouts yet.</p>
            ) : (
              <div className="space-y-3">
                {displayRequests.map(req => (
                  <div key={req.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      req.status === 'paid' ? 'bg-green-50' : req.status === 'failed' ? 'bg-red-50' : 'bg-yellow-50'
                    }`}>
                      {req.status === 'paid' ? (
                        <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                      ) : req.status === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-yellow-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[#111827]">{fmt(req.amount)}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(req.requested_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                        {req.reference ? ` · ${req.reference}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold ${
                      req.status === 'paid' ? 'text-green-600' : req.status === 'failed' ? 'text-red-500' : 'text-yellow-600'
                    }`}>
                      {req.status === 'paid' ? 'Completed' : req.status === 'failed' ? 'Failed' : 'Processing'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
