'use client'

import { DollarSign, TrendingUp, Clock, Download, Loader2 } from 'lucide-react'
import { useHostBookings } from '@/hooks/useBookings'
import { isSupabaseConfigured } from '@/lib/supabase/config'

const MOCK_MONTHLY = [
  { month: 'Jan', amount: 18400 },
  { month: 'Feb', amount: 22100 },
  { month: 'Mar', amount: 15800 },
  { month: 'Apr', amount: 31200 },
  { month: 'May', amount: 28900 },
  { month: 'Jun', amount: 35400 },
  { month: 'Jul', amount: 12600 },
]

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toCsv(rows: { date: string; renter: string; equipment: string; amount: number; status: string }[]) {
  const header = 'Date,Renter,Equipment,Amount (PHP),Status'
  const lines = rows.map((r) => `${r.date},"${r.renter}","${r.equipment}",${r.amount},${r.status}`)
  return [header, ...lines].join('\n')
}

export default function EarningsPage() {
  const live = isSupabaseConfigured()
  const { bookings, loading } = useHostBookings()

  const paid = bookings.filter((b) => b.payment_status === 'paid')
  const pendingPayout = bookings.filter((b) => b.status === 'confirmed' || b.status === 'active')

  // request_payout() pays hosts rental_fee + delivery_fee (038) — mirror that
  // here so the dashboard figures match what a payout actually settles.
  const totalEarned = live ? paid.reduce((s, b) => s + b.rental_fee + b.delivery_fee, 0) : 154600
  const pending = live ? pendingPayout.reduce((s, b) => s + b.rental_fee + b.delivery_fee, 0) : 7515

  const now = new Date()
  const thisMonth = live
    ? paid
        .filter((b) => b.paid_at && new Date(b.paid_at).getMonth() === now.getMonth() && new Date(b.paid_at).getFullYear() === now.getFullYear())
        .reduce((s, b) => s + b.rental_fee + b.delivery_fee, 0)
    : 35400

  // Last 7 months of paid rental income, oldest first
  const monthBuckets = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (6 - i), 1)
    return { year: d.getFullYear(), month: d.getMonth(), label: MONTH_LABELS[d.getMonth()] }
  })
  const liveMonthly = monthBuckets.map(({ year, month, label }) => ({
    month: label,
    amount: paid
      .filter((b) => b.paid_at && new Date(b.paid_at).getFullYear() === year && new Date(b.paid_at).getMonth() === month)
      .reduce((s, b) => s + b.rental_fee + b.delivery_fee, 0),
  }))
  const monthly = live ? liveMonthly : MOCK_MONTHLY
  const max = Math.max(...monthly.map((m) => m.amount), 1)

  const transactions = paid
    .slice()
    .sort((a, b) => new Date(b.paid_at ?? b.created_at).getTime() - new Date(a.paid_at ?? a.created_at).getTime())
    .slice(0, 10)

  function exportCsv() {
    const rows = transactions.map((t) => ({
      date: t.paid_at ?? t.created_at,
      renter: t.renter?.full_name ?? '',
      equipment: t.listing?.title ?? '',
      amount: t.rental_fee + t.delivery_fee,
      status: t.status,
    }))
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rentivo-earnings.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#111827]">Earnings</h1>
        <button
          onClick={exportCsv}
          disabled={live && transactions.length === 0}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl transition-colors"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {live && loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Total Earned', value: `₱${totalEarned.toLocaleString()}`, icon: DollarSign, color: 'text-[#22C55E] bg-green-50' },
              { label: 'Pending Payout', value: `₱${pending.toLocaleString()}`, icon: Clock, color: 'text-amber-500 bg-amber-50' },
              { label: 'This Month', value: `₱${thisMonth.toLocaleString()}`, icon: TrendingUp, color: 'text-[#003049] bg-blue-50' },
            ].map((s) => {
              const Icon = s.icon
              return (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="text-2xl font-bold text-[#111827]">{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              )
            })}
          </div>

          {/* Bar chart */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-bold text-[#111827] mb-5">Monthly Earnings</h2>
            <div className="flex items-end gap-3 h-40">
              {monthly.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-xs font-bold text-[#003049]">
                    {m.amount > 0 ? `₱${(m.amount / 1000).toFixed(m.amount < 1000 ? 1 : 0)}k` : ''}
                  </span>
                  <div className="w-full relative flex items-end" style={{ height: '96px' }}>
                    <div
                      className="w-full bg-[#003049] rounded-t-lg hover:bg-[#002438] transition-colors cursor-default"
                      style={{ height: `${(m.amount / max) * 100}%`, minHeight: '4px' }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-400 font-medium">{m.month}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payout account — not yet wired to a real payout provider, see Payout Settings */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-[#111827]">Payout Account</h2>
              <a href="/dashboard/payouts" className="text-xs font-semibold text-[#003049] hover:underline">Manage</a>
            </div>
            <p className="text-xs text-gray-400">
              Payouts are processed within 2–3 business days after a rental is completed. Configure your payout method in{' '}
              <a href="/dashboard/payouts" className="text-[#003049] hover:underline">Payout Settings</a>.
            </p>
          </div>

          {/* Transaction history */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-[#111827]">Transaction History</h2>
            </div>
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No paid rentals yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {transactions.map((t) => (
                  <div key={t.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#111827] truncate">{t.listing?.title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(t.paid_at ?? t.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}{t.renter?.full_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#111827]">₱{(t.rental_fee + t.delivery_fee).toLocaleString()}</p>
                      <span className="text-xs font-semibold text-[#22C55E]">Paid</span>
                    </div>
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
