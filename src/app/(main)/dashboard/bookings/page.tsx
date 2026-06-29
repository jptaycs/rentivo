'use client'

import { useState } from 'react'
import { MessageCircle, Check, X, Calendar, MapPin } from 'lucide-react'

const MOCK_BOOKINGS = [
  {
    id: 'BK001', ref: 'RNT-A3F9KX',
    renter: 'Maria Santos', renterInitial: 'M',
    equipment: 'Sony A7 IV',
    pickup: '2026-07-02', return: '2026-07-05', days: 3,
    total: 8540, deposit: 10000,
    status: 'confirmed', isDelivery: false,
    city: 'Makati',
  },
  {
    id: 'BK002', ref: 'RNT-B7X2QT',
    renter: 'John dela Cruz', renterInitial: 'J',
    equipment: 'Canon RF 70-200mm',
    pickup: '2026-07-06', return: '2026-07-07', days: 1,
    total: 3800, deposit: 8000,
    status: 'pending', isDelivery: true,
    city: 'Quezon City',
  },
  {
    id: 'BK003', ref: 'RNT-C1M5PW',
    renter: 'Trish Mendoza', renterInitial: 'T',
    equipment: 'Sony A7 IV',
    pickup: '2026-07-10', return: '2026-07-14', days: 4,
    total: 12800, deposit: 10000,
    status: 'confirmed', isDelivery: false,
    city: 'BGC',
  },
  {
    id: 'BK004', ref: 'RNT-D4K8LN',
    renter: 'Ryan Lim', renterInitial: 'R',
    equipment: 'iPhone 16 Pro Max',
    pickup: '2026-06-28', return: '2026-06-30', days: 2,
    total: 2760, deposit: 5000,
    status: 'completed', isDelivery: false,
    city: 'Pasig',
  },
  {
    id: 'BK005', ref: 'RNT-E9R3YH',
    renter: 'Grace Tan', renterInitial: 'G',
    equipment: 'Sony FX3',
    pickup: '2026-06-20', return: '2026-06-22', days: 2,
    total: 9540, deposit: 20000,
    status: 'completed', isDelivery: false,
    city: 'Mandaluyong',
  },
]

const TABS = ['All', 'Pending', 'Confirmed', 'Completed']

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#003049]',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-[#22C55E]',
  cancelled: 'bg-red-50 text-red-500',
}

export default function BookingsPage() {
  const [tab, setTab] = useState('All')

  const filtered = MOCK_BOOKINGS.filter(
    (b) => tab === 'All' || b.status === tab.toLowerCase()
  )

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-[#111827]">Bookings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === t ? 'bg-white text-[#003049] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
            {t !== 'All' && (
              <span className="ml-1.5 text-xs opacity-60">
                {MOCK_BOOKINGS.filter(b => b.status === t.toLowerCase()).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bookings list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No {tab.toLowerCase()} bookings</p>
          </div>
        ) : filtered.map((b) => (
          <div key={b.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#003049]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#003049] font-bold text-sm">{b.renterInitial}</span>
                  </div>
                  <div>
                    <p className="font-bold text-[#111827] text-sm">{b.renter}</p>
                    <p className="text-xs text-gray-500">{b.ref}</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${STATUS_STYLES[b.status]}`}>
                  {b.status}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Equipment</p>
                  <p className="font-semibold text-[#111827]">{b.equipment}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Dates</p>
                  <p className="font-semibold text-[#111827]">{fmt(b.pickup)} → {fmt(b.return)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Method</p>
                  <p className="font-semibold text-[#111827] flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-gray-400" />
                    {b.isDelivery ? 'Delivery' : 'Pickup'} · {b.city}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Payout</p>
                  <p className="font-bold text-[#003049]">₱{b.total.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> Message
              </button>
              {b.status === 'pending' && (
                <>
                  <button className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#003049] hover:bg-[#002438] px-3 py-1.5 rounded-lg transition-colors ml-auto">
                    <Check className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button className="flex items-center gap-1.5 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
                    <X className="w-3.5 h-3.5" /> Decline
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
