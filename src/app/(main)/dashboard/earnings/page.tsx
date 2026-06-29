import { DollarSign, TrendingUp, Clock, Download } from 'lucide-react'

const MONTHLY = [
  { month: 'Jan', amount: 18400 },
  { month: 'Feb', amount: 22100 },
  { month: 'Mar', amount: 15800 },
  { month: 'Apr', amount: 31200 },
  { month: 'May', amount: 28900 },
  { month: 'Jun', amount: 35400 },
  { month: 'Jul', amount: 12600 },
]

const TRANSACTIONS = [
  { id: 'P001', date: '2026-06-28', renter: 'Ryan Lim', equipment: 'iPhone 16 Pro Max', gross: 2760, fee: 331, net: 2429, status: 'paid' },
  { id: 'P002', date: '2026-06-22', renter: 'Grace Tan', equipment: 'Sony FX3', gross: 9540, fee: 1145, net: 8395, status: 'paid' },
  { id: 'P003', date: '2026-06-15', renter: 'Paolo Cruz', equipment: 'Sony A7 IV', gross: 12800, fee: 1536, net: 11264, status: 'paid' },
  { id: 'P004', date: '2026-07-05', renter: 'Maria Santos', equipment: 'Sony A7 IV', gross: 8540, fee: 1025, net: 7515, status: 'pending' },
]

const max = Math.max(...MONTHLY.map((m) => m.amount))

export default function EarningsPage() {
  const totalEarned = TRANSACTIONS.filter(t => t.status === 'paid').reduce((s, t) => s + t.net, 0)
  const pending = TRANSACTIONS.filter(t => t.status === 'pending').reduce((s, t) => s + t.net, 0)

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#111827]">Earnings</h1>
        <button className="flex items-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-xl transition-colors">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Earned', value: `₱${totalEarned.toLocaleString()}`, icon: DollarSign, color: 'text-[#22C55E] bg-green-50' },
          { label: 'Pending Payout', value: `₱${pending.toLocaleString()}`, icon: Clock, color: 'text-amber-500 bg-amber-50' },
          { label: 'This Month', value: '₱35,400', icon: TrendingUp, color: 'text-[#003049] bg-blue-50' },
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
        <h2 className="font-bold text-[#111827] mb-5">Monthly Earnings — 2026</h2>
        <div className="flex items-end gap-3 h-40">
          {MONTHLY.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-[#003049]">
                {m.amount > 0 ? `₱${(m.amount / 1000).toFixed(0)}k` : ''}
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

      {/* Payout account */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-[#111827]">Payout Account</h2>
          <button className="text-xs font-semibold text-[#003049] hover:underline">Edit</button>
        </div>
        <div className="flex items-center gap-4 p-4 bg-[#F8FAFC] rounded-xl border border-gray-100">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-[#003049] font-bold text-sm">
            G
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827]">GCash</p>
            <p className="text-xs text-gray-500">+63 917 •••• 4321</p>
          </div>
          <span className="ml-auto text-xs bg-green-50 text-[#22C55E] font-semibold px-2.5 py-1 rounded-full">Active</span>
        </div>
        <p className="text-xs text-gray-400 mt-3">Payouts are processed within 2–3 business days after rental completion.</p>
      </div>

      {/* Transaction history */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-[#111827]">Transaction History</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {TRANSACTIONS.map((t) => (
            <div key={t.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#111827]">{t.equipment}</p>
                <p className="text-xs text-gray-500">
                  {new Date(t.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' · '}{t.renter}
                </p>
              </div>
              <div className="text-right text-xs text-gray-400 hidden sm:block">
                <p>Gross ₱{t.gross.toLocaleString()}</p>
                <p>Fee -₱{t.fee.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-[#111827]">₱{t.net.toLocaleString()}</p>
                <span className={`text-xs font-semibold ${t.status === 'paid' ? 'text-[#22C55E]' : 'text-amber-600'}`}>
                  {t.status === 'paid' ? 'Paid out' : 'Pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
