'use client'

import { useState } from 'react'
import { Landmark, Plus, CheckCircle2, Clock, AlertCircle, ChevronRight } from 'lucide-react'

const PAYOUT_ACCOUNTS = [
  { id: 'p1', type: 'GCash', number: '•••• 1234', name: 'Juan P. Tayco', isDefault: true },
]

const PAYOUT_HISTORY = [
  { id: 'po1', amount: 12500, date: '2026-06-15', status: 'completed', ref: 'PO-2026-0615' },
  { id: 'po2', amount: 8750, date: '2026-05-28', status: 'completed', ref: 'PO-2026-0528' },
  { id: 'po3', amount: 4200, date: '2026-05-12', status: 'completed', ref: 'PO-2026-0512' },
  { id: 'po4', amount: 6800, date: '2026-04-30', status: 'completed', ref: 'PO-2026-0430' },
]

const PAYOUT_METHODS = ['GCash', 'Maya', 'Bank Transfer (Instapay)', 'BDO', 'BPI', 'UnionBank']

type Status = 'idle' | 'form'

export default function PayoutsPage() {
  const [status, setStatus] = useState<Status>('idle')
  const [method, setMethod] = useState('')
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [added, setAdded] = useState(false)

  function handleAdd() {
    if (!method || !number || !name) return
    setAdded(true)
    setStatus('idle')
  }

  const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Payouts</h1>
        <p className="text-gray-500 text-sm mt-1">Manage where you receive your earnings</p>
      </div>

      {/* Payout balance */}
      <div className="bg-gradient-to-br from-[#003049] to-blue-700 rounded-2xl p-6 text-white">
        <p className="text-sm font-medium opacity-80">Available for payout</p>
        <p className="text-4xl font-bold mt-1">₱32,250</p>
        <p className="text-sm opacity-70 mt-1">Processes within 1–2 business days</p>
        <button className="mt-4 bg-white text-[#003049] font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-colors">
          Request Payout
        </button>
      </div>

      {/* Payout accounts */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-[#111827]">Payout Accounts</p>
          {status === 'idle' && (
            <button onClick={() => setStatus('form')}
              className="flex items-center gap-1.5 text-sm font-semibold text-[#003049] hover:text-blue-700 transition-colors">
              <Plus className="w-4 h-4" /> Add account
            </button>
          )}
        </div>

        {PAYOUT_ACCOUNTS.map(acc => (
          <div key={acc.id} className="flex items-center gap-4 p-4 bg-[#F8FAFC] rounded-xl border border-gray-100">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-[#003049]" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-[#111827]">{acc.type} {acc.number}</p>
              <p className="text-xs text-gray-400">{acc.name}</p>
            </div>
            {acc.isDefault && (
              <span className="text-xs bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full">Default</span>
            )}
          </div>
        ))}

        {added && (
          <div className="flex items-center gap-4 p-4 bg-[#F8FAFC] rounded-xl border border-gray-100">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-[#FDF0D5]" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-[#111827]">{method} {number}</p>
              <p className="text-xs text-gray-400">{name}</p>
            </div>
            <span className="text-xs bg-yellow-100 text-yellow-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Clock className="w-3 h-3" /> Under review
            </span>
          </div>
        )}

        {/* Add account form */}
        {status === 'form' && (
          <div className="border border-[#003049]/30 rounded-xl p-5 space-y-4 bg-blue-50/30">
            <p className="font-bold text-sm text-[#111827]">Add Payout Account</p>

            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Payment Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)}
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

            <div className="flex gap-2">
              <button onClick={() => setStatus('idle')}
                className="flex-1 border border-gray-200 rounded-xl py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleAdd} disabled={!method || !number || !name}
                className="flex-1 bg-[#003049] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors">
                Add Account
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
        <div className="space-y-3">
          {PAYOUT_HISTORY.map(po => (
            <div key={po.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
              <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#111827]">{fmt(po.amount)}</p>
                <p className="text-xs text-gray-400">{new Date(po.date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })} · {po.ref}</p>
              </div>
              <span className="text-xs text-green-600 font-semibold">Completed</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
