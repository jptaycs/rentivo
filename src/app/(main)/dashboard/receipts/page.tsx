'use client'

import { useState } from 'react'
import { Download, FileText, Search } from 'lucide-react'

const MOCK_RECEIPTS = [
  { id: 'r1', ref: 'RNT-A3F9KX', equipment: 'Sony A7 IV', host: 'Carlo Santos', from: 'Jun 2', to: 'Jun 5', days: 3, total: 10800, date: '2026-06-02' },
  { id: 'r2', ref: 'RNT-B7X2QT', equipment: 'Canon RF 70-200mm f/2.8', host: 'Maria Reyes', from: 'May 15', to: 'May 17', days: 2, total: 6400, date: '2026-05-15' },
  { id: 'r3', ref: 'RNT-C1M5PW', equipment: 'Sony FX3', host: 'Jess Aguilar', from: 'Apr 20', to: 'Apr 24', days: 4, total: 22000, date: '2026-04-20' },
  { id: 'r4', ref: 'RNT-D4K8LN', equipment: 'iPhone 16 Pro Max', host: 'Carlo Santos', from: 'Mar 8', to: 'Mar 10', days: 2, total: 3600, date: '2026-03-08' },
]

const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`

export default function ReceiptsPage() {
  const [query, setQuery] = useState('')

  const filtered = MOCK_RECEIPTS.filter(r =>
    r.ref.toLowerCase().includes(query.toLowerCase()) ||
    r.equipment.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Receipts</h1>
        <p className="text-gray-500 text-sm mt-1">Download receipts for your completed rentals</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by booking ref or equipment…"
          className="w-full border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100 bg-white"
        />
      </div>

      {/* Receipts list */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="w-10 h-10 text-gray-200 mb-3" />
            <p className="font-semibold text-gray-400">No receipts found</p>
          </div>
        ) : (
          filtered.map(r => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
              <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-gray-400" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#111827] truncate">{r.equipment}</p>
                <p className="text-xs text-gray-400 mt-0.5">{r.ref} · {r.from}–{r.to} 2026 · {r.days} day{r.days > 1 ? 's' : ''} · Host: {r.host}</p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-[#111827]">{fmt(r.total)}</p>
                <p className="text-xs text-gray-400">{new Date(r.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>

              <button
                onClick={() => alert(`Downloading receipt for ${r.ref}…`)}
                className="w-9 h-9 border border-gray-200 rounded-xl flex items-center justify-center hover:border-[#2563EB] hover:text-[#2563EB] text-gray-400 transition-colors shrink-0"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Total spent */}
      {filtered.length > 0 && (
        <div className="bg-[#F8FAFC] border border-gray-100 rounded-2xl px-5 py-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">Total spent ({filtered.length} rentals)</span>
          <span className="font-bold text-[#111827]">{fmt(filtered.reduce((a, r) => a + r.total, 0))}</span>
        </div>
      )}
    </div>
  )
}
