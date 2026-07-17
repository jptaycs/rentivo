'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Download, FileText, Search, Loader2 } from 'lucide-react'
import { useMyRentals } from '@/hooks/useBookings'
import { isSupabaseConfigured } from '@/lib/supabase/config'

const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`

export default function ReceiptsPage() {
  const live = isSupabaseConfigured()
  const { bookings, loading } = useMyRentals()
  const [query, setQuery] = useState('')

  const receipts = bookings.filter((b) => b.payment_status === 'paid')
  const filtered = receipts.filter(r =>
    r.booking_ref.toLowerCase().includes(query.toLowerCase()) ||
    (r.listing?.title ?? '').toLowerCase().includes(query.toLowerCase())
  )

  const dateFmt = (d: string) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })

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
          className="w-full border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 bg-white"
        />
      </div>

      {/* Receipts list */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
        {live && loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
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
                <p className="text-sm font-bold text-[#111827] truncate">{r.listing?.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.booking_ref} · {dateFmt(r.pickup_date)}–{dateFmt(r.return_date)} · {r.total_days} day{r.total_days > 1 ? 's' : ''} · Host: {r.host?.full_name}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-[#111827]">{fmt(r.total_amount)}</p>
                <p className="text-xs text-gray-400">{r.paid_at ? dateFmt(r.paid_at) : ''}</p>
              </div>

              <Link
                href={`/book/complete?booking=${r.id}`}
                className="w-9 h-9 border border-gray-200 rounded-xl flex items-center justify-center hover:border-[#003049] hover:text-[#003049] text-gray-400 transition-colors shrink-0"
                aria-label="View receipt"
              >
                <Download className="w-4 h-4" />
              </Link>
            </div>
          ))
        )}
      </div>

      {/* Total spent */}
      {filtered.length > 0 && (
        <div className="bg-[#F8FAFC] border border-gray-100 rounded-2xl px-5 py-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">Total spent ({filtered.length} rental{filtered.length > 1 ? 's' : ''})</span>
          <span className="font-bold text-[#111827]">{fmt(filtered.reduce((a, r) => a + r.total_amount, 0))}</span>
        </div>
      )}
    </div>
  )
}
