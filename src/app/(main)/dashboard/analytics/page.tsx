'use client'

import { TrendingUp, Eye, CalendarDays, Star, Loader2 } from 'lucide-react'
import { useMyListings } from '@/hooks/useMyListings'
import { useHostBookings } from '@/hooks/useBookings'
import { useProfile } from '@/hooks/useProfile'
import { isSupabaseConfigured } from '@/lib/supabase/config'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function AnalyticsPage() {
  const live = isSupabaseConfigured()
  const { listings, loading: listingsLoading } = useMyListings()
  const { bookings, loading: bookingsLoading } = useHostBookings()
  const { profile, loading: profileLoading } = useProfile()

  const loading = live && (listingsLoading || bookingsLoading || profileLoading)

  const totalViews = listings.reduce((s, l) => s + l.view_count, 0)
  const totalBookings = bookings.length
  const repeatRenterIds = new Set(
    Object.entries(
      bookings.reduce<Record<string, number>>((acc, b) => {
        acc[b.renter_id] = (acc[b.renter_id] ?? 0) + 1
        return acc
      }, {})
    ).filter(([, count]) => count > 1).map(([id]) => id)
  )
  const uniqueRenters = new Set(bookings.map((b) => b.renter_id)).size
  const repeatRate = uniqueRenters > 0 ? Math.round((repeatRenterIds.size / uniqueRenters) * 100) : 0

  const now = new Date()
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const count = bookings.filter((b) => {
      const created = new Date(b.created_at)
      return created.getFullYear() === d.getFullYear() && created.getMonth() === d.getMonth()
    }).length
    return { month: MONTH_LABELS[d.getMonth()], bookings: count }
  })
  const maxBookings = Math.max(...monthly.map((m) => m.bookings), 1)

  const topListings = listings
    .slice()
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 5)
    .map((l) => {
      const listingBookings = bookings.filter((b) => b.listing_id === l.id).length
      return {
        name: l.title,
        views: l.view_count,
        bookings: listingBookings,
        convRate: l.view_count > 0 ? Math.round((listingBookings / l.view_count) * 1000) / 10 : 0,
        rating: l.rating,
      }
    })

  const KPIS = [
    { label: 'Total Views', value: String(totalViews), icon: Eye, color: 'text-blue-600 bg-blue-50' },
    { label: 'Total Bookings', value: String(totalBookings), icon: CalendarDays, color: 'text-purple-600 bg-purple-50' },
    { label: 'Avg Rating', value: profile?.host_rating != null ? profile.host_rating.toFixed(1) : '—', icon: Star, color: 'text-yellow-600 bg-yellow-50' },
    { label: 'Repeat Renters', value: `${repeatRate}%`, icon: TrendingUp, color: 'text-green-600 bg-green-50' },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">How your listings are performing</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
          No listings yet — analytics appear once you publish one.
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {KPIS.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <p className="text-2xl font-bold text-[#111827]">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Bookings chart */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="mb-6">
              <p className="font-bold text-[#111827]">Bookings</p>
              <p className="text-xs text-gray-400 mt-0.5">Last 6 months</p>
            </div>

            <div className="flex items-end gap-3 h-40">
              {monthly.map(d => (
                <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '120px' }}>
                    <div
                      className="w-full max-w-8 bg-[#003049]/20 border border-[#003049]/40 rounded-t-sm"
                      style={{ height: `${(d.bookings / maxBookings) * 100}%`, minHeight: d.bookings > 0 ? '4px' : '0' }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400">{d.month}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top listings */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <p className="font-bold text-[#111827] mb-4">Top Performing Listings</p>
            <div className="space-y-4">
              {topListings.map((l, i) => (
                <div key={l.name} className="flex items-center gap-4">
                  <span className="w-6 h-6 rounded-full bg-gray-100 text-xs font-bold text-gray-500 flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#111827] truncate">{l.name}</p>
                    <p className="text-xs text-gray-400">{l.views} views · {l.bookings} bookings</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-[#003049]">{l.convRate}%</p>
                    <p className="text-[10px] text-gray-400">conversion</p>
                  </div>
                  {l.rating != null && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                      <span className="text-sm font-bold text-[#111827]">{l.rating}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
