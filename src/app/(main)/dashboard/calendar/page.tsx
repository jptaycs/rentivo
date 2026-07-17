'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, AlertCircle, Loader2 } from 'lucide-react'
import { useMyListings } from '@/hooks/useMyListings'
import { useAvailabilityBlocks } from '@/hooks/useAvailabilityBlocks'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { MOCK_LISTINGS } from '@/lib/mock-data'

const PALETTE = [
  { dot: 'bg-blue-500', light: 'bg-blue-100 text-blue-700' },
  { dot: 'bg-[#FDF0D5]', light: 'bg-orange-100 text-orange-700' },
  { dot: 'bg-purple-500', light: 'bg-purple-100 text-purple-700' },
  { dot: 'bg-teal-500', light: 'bg-teal-100 text-teal-700' },
  { dot: 'bg-pink-500', light: 'bg-pink-100 text-pink-700' },
]

function buildCalendar(year: number, month: number) {
  const first = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  return { first, days }
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function CalendarPage() {
  const live = isSupabaseConfigured()
  const { listings: liveListings, loading: listingsLoading } = useMyListings()
  const listings = (live ? liveListings : MOCK_LISTINGS.slice(0, 3)).filter((l) => l.is_active)
  const listingIds = useMemo(() => listings.map((l) => l.id), [listings])
  const { blocks, loading: blocksLoading, error, toggle, blockFor } = useAvailabilityBlocks(live ? listingIds : [])

  const colorOf = (listingId: string) => PALETTE[listings.findIndex((l) => l.id === listingId) % PALETTE.length]

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [activeListing, setActiveListing] = useState<string | null>(null)

  const { first, days } = buildCalendar(year, month)

  function pad(n: number) { return String(n).padStart(2, '0') }
  function dateKey(d: number) { return `${year}-${pad(month + 1)}-${pad(d)}` }
  function isToday(d: number) {
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
  }
  function blockedByListing(d: number): string | null {
    const key = dateKey(d)
    for (const id of listingIds) {
      if (blockFor(id, key)) return id
    }
    return null
  }

  function handleClick(d: number) {
    if (!activeListing || !live) return
    const key = dateKey(d)
    const t = new Date(); t.setHours(0, 0, 0, 0)
    if (new Date(key) < t) return
    toggle(activeListing, key)
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

  const loading = live && (listingsLoading || blocksLoading)

  const blockedThisMonth = (listingId: string) =>
    blocks.filter((b) => b.listing_id === listingId && b.blocked_on.startsWith(`${year}-${pad(month + 1)}`))

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Availability Calendar</h1>
        <p className="text-gray-500 text-sm mt-1">Block dates when your equipment is unavailable</p>
      </div>

      {listings.length === 0 && !loading ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 text-gray-400">
          No active listings yet — availability appears here once you have one.
        </div>
      ) : (
        <>
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
              {listings.map((l) => {
                const c = colorOf(l.id)
                return (
                  <button
                    key={l.id}
                    onClick={() => setActiveListing(l.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                      activeListing === l.id ? `${c.light} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                    {l.title.split(' ').slice(0, 3).join(' ')}
                  </button>
                )
              })}
            </div>
            {activeListing && live && (
              <p className="text-xs text-[#003049] flex items-center gap-1.5">
                <Info className="w-3 h-3" />
                Click any future date to block or unblock it for this listing.
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Calendar */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden relative">
            {loading && (
              <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
                <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
              </div>
            )}
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
                  const blockedListingId = blockedByListing(d)
                  const isT = isToday(d)
                  const isPast = new Date(dateKey(d)) < new Date(new Date().toDateString())
                  const c = blockedListingId ? colorOf(blockedListingId) : null
                  const canClick = activeListing && !isPast && live

                  return (
                    <button
                      key={d}
                      onClick={() => handleClick(d)}
                      disabled={!canClick}
                      className={`
                        aspect-square rounded-xl flex items-center justify-center text-sm font-medium transition-all
                        ${isPast ? 'opacity-30 cursor-default' : canClick ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}
                        ${isT ? 'ring-2 ring-[#003049]' : ''}
                        ${c ? `${c.dot} text-white` : 'text-[#111827]'}
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
              {listings.map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-xs text-gray-500">
                  <span className={`w-3 h-3 rounded ${colorOf(l.id).dot}`} />
                  {l.title.split(' ').slice(0, 3).join(' ')}
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-3 h-3 rounded ring-2 ring-[#003049]" />
                Today
              </div>
            </div>
          </div>

          {/* Blocked summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="font-bold text-[#111827] mb-3 text-sm">Blocked Periods This Month</p>
            {listings.map((l) => {
              const thisMonth = blockedThisMonth(l.id)
              if (thisMonth.length === 0) return null
              return (
                <div key={l.id} className="flex items-start gap-3 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${colorOf(l.id).dot} mt-1 shrink-0`} />
                  <div>
                    <p className="text-xs font-semibold text-[#111827]">{l.title.split(' ').slice(0, 3).join(' ')}</p>
                    <p className="text-xs text-gray-400">{thisMonth.length} day{thisMonth.length > 1 ? 's' : ''} blocked</p>
                  </div>
                </div>
              )
            })}
            {listings.every((l) => blockedThisMonth(l.id).length === 0) && (
              <p className="text-xs text-gray-400">No dates blocked this month.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
