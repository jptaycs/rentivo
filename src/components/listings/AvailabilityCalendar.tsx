'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CalendarMonth } from '@/components/search/CalendarMonth'
import { toMidnight, toLocalISODate, parseDateParam } from '@/components/search/calendarUtils'

interface AvailabilityCalendarProps {
  /** Local `YYYY-MM-DD` keys the listing is unavailable on. */
  blockedDates: Set<string>
  /** Selected pickup date, `YYYY-MM-DD`, or '' for none. */
  pickupDate: string
  /** Selected return date, `YYYY-MM-DD`, or '' for none. */
  returnDate: string
  onChange: (pickup: string, ret: string) => void
}

/**
 * Renter-facing date picker for one listing, showing which days are unavailable.
 *
 * Replaces two native `<input type="date">` fields, which cannot mark, disable
 * or explain individual days — so a renter could only discover a clash by
 * picking a range and being told afterwards.
 *
 * ── The boundary rule, which this deliberately mirrors ──
 * `is_listing_available(listing, from, to)` (migration 002) tests
 * `blocked_on between p_from and p_to - 1`. The RETURN DAY IS EXCLUDED: the
 * renter hands the gear back that morning, so the host can re-let it the same
 * day. That means a range may legally *end on* a blocked day but never span
 * past one. `maxEnd` below is therefore the first blocked day after the pickup
 * date INCLUSIVE, not the day before it. Getting this off by one would make the
 * calendar disagree with the server in one direction or the other — either
 * refusing bookings the database would accept, or offering ones it rejects.
 */
export function AvailabilityCalendar({
  blockedDates, pickupDate, returnDate, onChange,
}: AvailabilityCalendarProps) {
  const today = useMemo(() => toMidnight(new Date()), [])
  const startDate = parseDateParam(pickupDate)
  const endDate = parseDateParam(returnDate)
  const [hoverDate, setHoverDate] = useState<Date | null>(null)
  const [cursor, setCursor] = useState(() => {
    const from = startDate ?? today
    return { year: from.getFullYear(), month: from.getMonth() }
  })

  /** First blocked day strictly after `from`, inclusive as a return date. */
  const maxEnd = useMemo(() => {
    if (!startDate || blockedDates.size === 0) return null
    // Walk forward a year; a listing blocked solidly for longer than that has
    // no selectable range anyway and the null result behaves identically.
    const probe = new Date(startDate)
    for (let i = 0; i < 366; i++) {
      probe.setDate(probe.getDate() + 1)
      if (blockedDates.has(toLocalISODate(probe))) return new Date(probe)
    }
    return null
  }, [startDate, blockedDates])

  function handleDateClick(date: Date) {
    const key = toLocalISODate(date)
    // Starting a fresh range: either nothing picked yet, a complete range is
    // already showing, or the click landed on/before the current pickup date.
    if (!startDate || endDate || date.getTime() <= startDate.getTime()) {
      onChange(key, '')
      return
    }
    onChange(pickupDate, key)
  }

  const monthLabelDate = new Date(cursor.year, cursor.month, 1)
  const atFirstMonth =
    cursor.year === today.getFullYear() && cursor.month === today.getMonth()

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1 mb-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={atFirstMonth}
          aria-label="Previous month"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <CalendarMonth
        year={monthLabelDate.getFullYear()}
        month={monthLabelDate.getMonth()}
        startDate={startDate}
        endDate={endDate}
        hoverDate={hoverDate}
        today={today}
        onDateClick={handleDateClick}
        onDateHover={setHoverDate}
        blockedDates={blockedDates}
        isDisabled={(d) => {
          // CalendarMonth no longer treats "blocked" as "unclickable", so this
          // is the ONLY place deciding what can be picked. Two distinct modes:
          const choosingEnd = !!startDate && !endDate && d.getTime() > startDate.getTime()
          if (choosingEnd) {
            // Picking a return date: legal up to and INCLUDING maxEnd, the
            // first blocked day after pickup — the return day is excluded from
            // the server's `p_from .. p_to - 1` check, so ending on a blocked
            // day is fine. Anything beyond it would span that day.
            return !!maxEnd && d.getTime() > maxEnd.getTime()
          }
          // Otherwise this click starts (or restarts) a range, and a rental
          // cannot BEGIN on a day the gear isn't free — the pickup day is
          // inside that same server check.
          return blockedDates.has(toLocalISODate(d))
        }}
      />

      {/* Legend — the point of this component. Mirrors the three states a day
          can actually be in above; "Unavailable" uses the same struck-through
          grey treatment as the real cells rather than a colour swatch, so the
          key matches what the eye sees in the grid. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 justify-center mt-3 pt-3 border-t border-gray-100">
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="w-4 h-4 rounded-full border border-gray-200 bg-white" />
          Available
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="w-2.5 h-px bg-gray-400" />
          </span>
          Unavailable
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="w-4 h-4 rounded-full bg-[#003049]" />
          Your dates
        </span>
      </div>
    </div>
  )
}
