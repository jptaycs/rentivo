import { DollarSign, Package, CalendarDays, Star, TrendingUp, ArrowUpRight, Clock } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'

const STATS = [
  { label: 'Total Earnings', value: '₱128,400', change: '+12%', icon: DollarSign, color: 'bg-green-50 text-green-600' },
  { label: 'Active Listings', value: '4', change: '+1', icon: Package, color: 'bg-blue-50 text-[#2563EB]' },
  { label: 'Bookings This Month', value: '18', change: '+5', icon: CalendarDays, color: 'bg-orange-50 text-[#F97316]' },
  { label: 'Average Rating', value: '4.97', change: '+0.02', icon: Star, color: 'bg-amber-50 text-amber-500' },
]

const RECENT_BOOKINGS = [
  { id: 'BK001', renter: 'Maria Santos', equipment: 'Sony A7 IV', dates: 'Jul 2–5', amount: 8540, status: 'confirmed' },
  { id: 'BK002', renter: 'John dela Cruz', equipment: 'Canon RF 70-200mm', dates: 'Jul 6–7', amount: 3800, status: 'pending' },
  { id: 'BK003', renter: 'Trish Mendoza', equipment: 'Sony A7 IV', dates: 'Jul 10–14', amount: 12800, status: 'confirmed' },
  { id: 'BK004', renter: 'Ryan Lim', equipment: 'iPhone 16 Pro Max', dates: 'Jun 28–30', amount: 2760, status: 'completed' },
]

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#2563EB]',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-[#22C55E]',
  cancelled: 'bg-red-50 text-red-600',
}

export default function OverviewPage() {
  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Good morning, Juan 👋</h1>
          <p className="text-gray-500 text-sm mt-0.5">Here's what's happening with your listings.</p>
        </div>
        <Link
          href="/host/new"
          className="bg-[#2563EB] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <Package className="w-4 h-4" />
          New Listing
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="flex items-center gap-0.5 text-xs font-semibold text-[#22C55E]">
                  <TrendingUp className="w-3 h-3" />
                  {s.change}
                </span>
              </div>
              <p className="text-2xl font-bold text-[#111827]">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Earnings sparkline */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-[#111827]">Earnings — Last 7 Days</h2>
            <p className="text-xs text-gray-400 mt-0.5">Daily rental income</p>
          </div>
          <span className="text-2xl font-bold text-[#2563EB]">₱28,400</span>
        </div>
        {/* Simple bar chart */}
        {(() => {
          const bars = [4200, 0, 8540, 2500, 5800, 3200, 4160]
          const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
          const max = Math.max(...bars)
          return (
            <div className="flex items-end gap-2 h-32">
              {bars.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full relative flex items-end" style={{ height: '100px' }}>
                    <div
                      className={`w-full rounded-t-lg transition-all ${v > 0 ? 'bg-[#2563EB]' : 'bg-gray-100'}`}
                      style={{ height: v > 0 ? `${(v / max) * 100}%` : '8px' }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">{days[i]}</span>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Recent bookings */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-[#111827]">Recent Bookings</h2>
          <Link href="/dashboard/bookings" className="text-xs text-[#2563EB] font-semibold hover:underline flex items-center gap-1">
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-gray-100">
          {RECENT_BOOKINGS.map((b) => (
            <div key={b.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="w-8 h-8 rounded-full bg-[#2563EB]/10 flex items-center justify-center shrink-0">
                <span className="text-[#2563EB] text-xs font-bold">{b.renter[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#111827] truncate">{b.renter}</p>
                <p className="text-xs text-gray-500 truncate">{b.equipment} · {b.dates}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[b.status]}`}>
                {b.status}
              </span>
              <p className="text-sm font-bold text-[#111827] w-20 text-right shrink-0">
                ₱{b.amount.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Update availability', href: '/dashboard/listings', icon: CalendarDays },
          { label: 'View all reviews', href: '/dashboard/reviews', icon: Star },
          { label: 'Payout settings', href: '/dashboard/payouts', icon: DollarSign },
        ].map(({ label, href, icon: Icon }) => (
          <Link key={label} href={href}
            className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-4 text-sm font-medium text-gray-700 hover:border-[#2563EB] hover:text-[#2563EB] transition-all group"
          >
            <Icon className="w-4 h-4 text-gray-400 group-hover:text-[#2563EB] transition-colors" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
