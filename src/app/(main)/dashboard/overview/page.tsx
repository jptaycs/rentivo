'use client'

import { DollarSign, Package, CalendarDays, Star, ArrowUpRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useHostBookings } from '@/hooks/useBookings'
import { useMyListings } from '@/hooks/useMyListings'
import { useProfile } from '@/hooks/useProfile'
import { isSupabaseConfigured } from '@/lib/supabase/config'

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#003049]',
  pending: 'bg-amber-50 text-amber-700',
  active: 'bg-blue-50 text-[#003049]',
  completed: 'bg-green-50 text-[#22C55E]',
  cancelled: 'bg-red-50 text-red-600',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function OverviewPage() {
  const live = isSupabaseConfigured()
  const { bookings, loading: bookingsLoading } = useHostBookings()
  const { listings, loading: listingsLoading } = useMyListings()
  const { profile, loading: profileLoading } = useProfile()

  const loading = live && (bookingsLoading || listingsLoading || profileLoading)

  const paid = bookings.filter((b) => b.payment_status === 'paid')
  const activeListings = listings.filter((l) => l.is_active).length

  const now = new Date()
  const bookingsThisMonth = bookings.filter((b) => {
    const d = new Date(b.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  // Last 7 days of paid earnings, oldest first
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    return d
  })
  const liveBars = days.map((day) => {
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    return paid
      .filter((b) => b.paid_at && new Date(b.paid_at) >= day && new Date(b.paid_at) < next)
      .reduce((sum, b) => sum + b.rental_fee, 0)
  })
  const bars = live ? liveBars : [4200, 0, 8540, 2500, 5800, 3200, 4160]
  const weekTotal = bars.reduce((a, b) => a + b, 0)
  const maxBar = Math.max(...bars, 1)

  const recentBookings = bookings.slice(0, 5)

  const firstName = live ? (profile?.full_name?.split(' ')[0] ?? 'there') : 'Juan'

  const STATS = live
    ? [
        { label: 'Total Earnings', value: `₱${paid.reduce((sum, b) => sum + b.rental_fee, 0).toLocaleString()}`, icon: DollarSign, color: 'bg-green-50 text-green-600' },
        { label: 'Active Listings', value: String(activeListings), icon: Package, color: 'bg-blue-50 text-[#003049]' },
        { label: 'Bookings This Month', value: String(bookingsThisMonth), icon: CalendarDays, color: 'bg-orange-50 text-[#FDF0D5]' },
        { label: 'Average Rating', value: profile?.host_rating != null ? profile.host_rating.toFixed(2) : '—', icon: Star, color: 'bg-amber-50 text-amber-500' },
      ]
    : [
        { label: 'Total Earnings', value: '₱128,400', icon: DollarSign, color: 'bg-green-50 text-green-600' },
        { label: 'Active Listings', value: '4', icon: Package, color: 'bg-blue-50 text-[#003049]' },
        { label: 'Bookings This Month', value: '18', icon: CalendarDays, color: 'bg-orange-50 text-[#FDF0D5]' },
        { label: 'Average Rating', value: '4.97', icon: Star, color: 'bg-amber-50 text-amber-500' },
      ]

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Welcome back, {firstName} 👋</h1>
          <p className="text-gray-500 text-sm mt-0.5">Here's what's happening with your listings.</p>
        </div>
        <Link
          href="/host/new"
          className="bg-[#003049] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#002438] transition-colors flex items-center gap-2"
        >
          <Package className="w-4 h-4" />
          New Listing
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS.map((s) => {
              const Icon = s.icon
              return (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-4`}>
                    <Icon className="w-5 h-5" />
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
              <span className="text-2xl font-bold text-[#003049]">₱{weekTotal.toLocaleString()}</span>
            </div>
            <div className="flex items-end gap-2 h-32">
              {bars.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full relative flex items-end" style={{ height: '100px' }}>
                    <div
                      className={`w-full rounded-t-lg transition-all ${v > 0 ? 'bg-[#003049]' : 'bg-gray-100'}`}
                      style={{ height: v > 0 ? `${(v / maxBar) * 100}%` : '8px' }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">{DAY_LABELS[days[i].getDay()]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent bookings */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-[#111827]">Recent Bookings</h2>
              <Link href="/dashboard/bookings" className="text-xs text-[#003049] font-semibold hover:underline flex items-center gap-1">
                View all <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            {recentBookings.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No bookings yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {recentBookings.map((b) => (
                  <div key={b.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[#003049]/10 flex items-center justify-center shrink-0">
                      <span className="text-[#003049] text-xs font-bold">{(b.renter?.full_name ?? '?')[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#111827] truncate">{b.renter?.full_name}</p>
                      <p className="text-xs text-gray-500 truncate">{b.listing?.title} · {fmt(b.pickup_date)}–{fmt(b.return_date)}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[b.status]}`}>
                      {b.status}
                    </span>
                    <p className="text-sm font-bold text-[#111827] w-20 text-right shrink-0">
                      ₱{b.total_amount.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Update availability', href: '/dashboard/calendar', icon: CalendarDays },
          { label: 'View all reviews', href: '/dashboard/reviews', icon: Star },
          { label: 'Payout settings', href: '/dashboard/payouts', icon: DollarSign },
        ].map(({ label, href, icon: Icon }) => (
          <Link key={label} href={href}
            className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-4 text-sm font-medium text-gray-700 hover:border-[#003049] hover:text-[#003049] transition-all group"
          >
            <Icon className="w-4 h-4 text-gray-400 group-hover:text-[#003049] transition-colors" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
