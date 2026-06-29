'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Calendar, MapPin, MessageCircle, Star, Package } from 'lucide-react'
import { MOCK_LISTINGS } from '@/lib/mock-data'

const UPCOMING = [
  { id: 'u1', listing: MOCK_LISTINGS[0], pickup: '2026-07-02', return: '2026-07-05', ref: 'RNT-A3F9KX', status: 'confirmed', isDelivery: false },
  { id: 'u2', listing: MOCK_LISTINGS[2], pickup: '2026-07-10', return: '2026-07-11', ref: 'RNT-C9P2MX', status: 'pending', isDelivery: true },
]

const HISTORY = [
  { id: 'h1', listing: MOCK_LISTINGS[3], pickup: '2026-06-15', return: '2026-06-17', ref: 'RNT-D2K5QR', status: 'completed', reviewed: false },
  { id: 'h2', listing: MOCK_LISTINGS[1], pickup: '2026-05-20', return: '2026-05-22', ref: 'RNT-E7N1WP', status: 'completed', reviewed: true },
]

const TABS = ['Upcoming', 'History']

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-[#2563EB]',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-[#22C55E]',
}

export default function RentalsPage() {
  const [tab, setTab] = useState('Upcoming')
  const items = tab === 'Upcoming' ? UPCOMING : HISTORY

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-[#111827]">My Rentals</h1>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === t ? 'bg-white text-[#2563EB] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {items.length === 0 ? (
          <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No {tab.toLowerCase()} rentals</p>
            <Link href="/search" className="text-sm text-[#2563EB] hover:underline mt-2 inline-block">Browse equipment →</Link>
          </div>
        ) : items.map((item) => (
          <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex gap-4 p-5">
              <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0">
                <Image src={item.listing.images[0]} alt={item.listing.title} fill className="object-cover" sizes="80px" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-400">{item.listing.brand}</p>
                    <h3 className="font-bold text-[#111827] text-sm line-clamp-1">{item.listing.title}</h3>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize shrink-0 ${STATUS_STYLES[item.status]}`}>
                    {item.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{fmt(item.pickup)} → {fmt(item.return)}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.listing.city}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{item.ref}</p>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <Link href={`/listings/${item.listing.id}`}
                className="text-xs font-medium text-gray-600 hover:text-[#2563EB] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                View listing
              </Link>
              <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#2563EB] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                <MessageCircle className="w-3.5 h-3.5" /> Message Host
              </button>
              {'reviewed' in item && !item.reviewed && item.status === 'completed' && (
                <button className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-amber-600 border border-amber-200 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors">
                  <Star className="w-3.5 h-3.5" /> Leave Review
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
