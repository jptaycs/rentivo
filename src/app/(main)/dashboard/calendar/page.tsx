'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { MOCK_LISTINGS } from '@/lib/mock-data'

const MY_LISTINGS = MOCK_LISTINGS.slice(0, 3)

function buildCalendar(year: number, month: number) {
  const first = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  return { first, days }
}

const MOCK_BLOCKS: Record<string, Record<string, string>> = {
  '1': { '2026-07-05': '1', '2026-07-06': '1', '2026-07-07': '1', '2026-07-15': '1', '2026-07-16': '1' },
  '2': { '2026-07-10': '2', '2026-07-11': '2', '2026-07-12': '2' },
  '3': { '2026-07-20': '3', '2026-07-21': '3', '2026-07-22': '3', '2026-07-23': '3' },
}

const LISTING_COLORS: Record<string, string> = {
  '1': 'bg-blue-500',
  '2': 'bg-[#F97316]',
  '3': 'bg-purple-500',
}
const LISTING_LIGHT: Record<string, string> = {
  '1': 'bg-blue-100 text-blue-700',
  '2': 'bg-orange-100 text-orange-700',
  '3': 'bg-purple-100 text-purple-700',
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(2026)
  const [month, setMonth] = useState(6) // July
  const [activeListing, setActiveListing] = useState<string | null>(null)
  const [blocks, setBlocks] = useState(MOCK_BLOCKS)

  const { first, days } = buildCalendar(year, month)

  function pad(n: number) { return String(n).padStart(2, '0') }
  function dateKey(d: number) { return `${year}-${pad(month + 1)}-${pad(d)}` }
  function isToday(d: number) {
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
  }
  function blockedBy(d: number): string | null {
    const key = dateKey(d)
    for (const [lid, dates] of Object.entries(blocks)) {
      if (dates[key]) return lid
    }
    return null
  }
  function toggleBlock(d: number) {
    if (!activeListing) return
    const key = dateKey(d)
    const today = new Date(); today.setHours(0,0,0,0)
    if (new Date(key) < today) return
    setBlocks(prev => {
      const current = { ...(prev[activeListing] ?? {}) }
      if (current[key]) delete current[key]
      else current[key] = activeListing
      return { ...prev, [activeListing]: current }
    })
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const cells = Array.from({ length: first + days }, (_, i) => (i < first ? null : i - first + 1))

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Availability Calendar</h1>
        <p className="text-gray-500 text-sm mt-1">Block dates when your equipment is unavailable</p>
      </div>

      {/* Listing selector */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Select Listing to Edit</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveListing(null)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              activeListing === null ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            View All
          </button>
          {MY_LISTINGS.map(l => (
            <button
              key={l.id}
              onClick={() => setActiveListing(l.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                activeListing === l.id
                  ? `${LISTING_LIGHT[l.id]} border-transparent`
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${LISTING_COLORS[l.id]}`} />
              {l.title.split(' ').slice(0,3).join(' ')}
            </button>
          ))}
        </div>
        {activeListing && (
          <p className="text-xs text-[#2563EB] flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            Click any future date to block or unblock it for this listing.
          </p>
        )}
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <p className="font-bold text-[#111827]">{MONTHS[month]} {year}</p>
          <button onClick={nextMonth} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="p-4">
          {/* Day labels */}
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase py-1">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />
              const blocked = blockedBy(d)
              const isT = isToday(d)
              const isPast = new Date(dateKey(d)) < new Date(new Date().toDateString())
              const color = blocked ? LISTING_COLORS[blocked] : ''
              const canClick = activeListing && !isPast

              return (
                <button
                  key={d}
                  onClick={() => toggleBlock(d)}
                  disabled={!canClick}
                  className={`
                    aspect-square rounded-xl flex items-center justify-center text-sm font-medium transition-all
                    ${isPast ? 'opacity-30 cursor-default' : canClick ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}
                    ${isT ? 'ring-2 ring-[#2563EB]' : ''}
                    ${blocked ? `${color} text-white` : 'text-[#111827]'}
                  `}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="border-t border-gray-100 px-5 py-3 flex flex-wrap gap-4">
          {MY_LISTINGS.map(l => (
            <div key={l.id} className="flex items-center gap-2 text-xs text-gray-500">
              <span className={`w-3 h-3 rounded ${LISTING_COLORS[l.id]}`} />
              {l.title.split(' ').slice(0, 3).join(' ')}
            </div>
          ))}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-3 rounded ring-2 ring-[#2563EB]" />
            Today
          </div>
        </div>
      </div>

      {/* Blocked summary */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="font-bold text-[#111827] mb-3 text-sm">Blocked Periods This Month</p>
        {MY_LISTINGS.map(l => {
          const thisMonth = Object.keys(blocks[l.id] ?? {}).filter(k => k.startsWith(`${year}-${pad(month + 1)}`)).sort()
          if (thisMonth.length === 0) return null
          return (
            <div key={l.id} className="flex items-start gap-3 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${LISTING_COLORS[l.id]} mt-1 shrink-0`} />
              <div>
                <p className="text-xs font-semibold text-[#111827]">{l.title.split(' ').slice(0, 3).join(' ')}</p>
                <p className="text-xs text-gray-400">{thisMonth.length} day{thisMonth.length > 1 ? 's' : ''} blocked</p>
              </div>
            </div>
          )
        })}
        {MY_LISTINGS.every(l => !Object.keys(blocks[l.id] ?? {}).some(k => k.startsWith(`${year}-${pad(month + 1)}`))) && (
          <p className="text-xs text-gray-400">No dates blocked this month.</p>
        )}
      </div>
    </div>
  )
}
