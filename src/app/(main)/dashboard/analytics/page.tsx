'use client'

import { TrendingUp, Eye, MousePointerClick, Star, Calendar, ArrowUpRight } from 'lucide-react'

const MONTHLY_DATA = [
  { month: 'Jan', views: 42, bookings: 3 },
  { month: 'Feb', views: 67, bookings: 5 },
  { month: 'Mar', views: 55, bookings: 4 },
  { month: 'Apr', views: 90, bookings: 7 },
  { month: 'May', views: 78, bookings: 6 },
  { month: 'Jun', views: 124, bookings: 9 },
]

const TOP_LISTINGS = [
  { name: 'Sony A7 IV + Kit Lens', views: 312, bookings: 18, convRate: 5.8, rating: 4.9 },
  { name: 'Canon RF 70-200mm f/2.8', views: 198, bookings: 11, convRate: 5.6, rating: 4.8 },
  { name: 'Sony FX3 Cinema Camera', views: 145, bookings: 7, convRate: 4.8, rating: 5.0 },
]

export default function AnalyticsPage() {
  const maxViews = Math.max(...MONTHLY_DATA.map(d => d.views))
  const maxBookings = Math.max(...MONTHLY_DATA.map(d => d.bookings))

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">How your listings are performing</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Views', value: '456', change: '+18%', icon: Eye, color: 'text-blue-600 bg-blue-50' },
          { label: 'Profile Clicks', value: '89', change: '+12%', icon: MousePointerClick, color: 'text-purple-600 bg-purple-50' },
          { label: 'Avg Rating', value: '4.9', change: '+0.1', icon: Star, color: 'text-yellow-600 bg-yellow-50' },
          { label: 'Repeat Renters', value: '34%', change: '+5%', icon: TrendingUp, color: 'text-green-600 bg-green-50' },
        ].map(({ label, value, change, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-[#111827]">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            <p className="text-xs text-green-600 font-semibold mt-1 flex items-center gap-0.5">
              <ArrowUpRight className="w-3 h-3" /> {change} this month
            </p>
          </div>
        ))}
      </div>

      {/* Views chart */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="font-bold text-[#111827]">Views & Bookings</p>
            <p className="text-xs text-gray-400 mt-0.5">Last 6 months</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#003049]/20 border border-[#003049]" />Views</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#F97316]/20 border border-[#F97316]" />Bookings</span>
          </div>
        </div>

        <div className="flex items-end gap-3 h-40">
          {MONTHLY_DATA.map(d => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex gap-1 items-end" style={{ height: '120px' }}>
                <div
                  className="flex-1 bg-[#003049]/20 border border-[#003049]/40 rounded-t-sm"
                  style={{ height: `${(d.views / maxViews) * 100}%` }}
                />
                <div
                  className="flex-1 bg-[#F97316]/20 border border-[#F97316]/40 rounded-t-sm"
                  style={{ height: `${(d.bookings / maxBookings) * 100}%` }}
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
          {TOP_LISTINGS.map((l, i) => (
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
              <div className="flex items-center gap-1 shrink-0">
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                <span className="text-sm font-bold text-[#111827]">{l.rating}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search keywords */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <p className="font-bold text-[#111827] mb-4">How Renters Found You</p>
        <div className="space-y-3">
          {[
            { keyword: 'sony a7 mirrorless', pct: 38 },
            { keyword: 'camera rental manila', pct: 27 },
            { keyword: 'sony a7iv bgc', pct: 19 },
            { keyword: 'full frame camera rent', pct: 16 },
          ].map(({ keyword, pct }) => (
            <div key={keyword} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-44 truncate">{keyword}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#003049] rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs font-semibold text-gray-600 w-8 text-right">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
