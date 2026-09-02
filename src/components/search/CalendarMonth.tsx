import { MONTH_NAMES, DAY_LABELS } from './searchBarData'
import { isSameDay, isBetween, toLocalISODate } from './calendarUtils'

export function CalendarMonth({
  year, month, startDate, endDate, hoverDate, today, onDateClick, onDateHover,
  blockedDates, isDisabled,
}: {
  year: number; month: number
  startDate: Date | null; endDate: Date | null; hoverDate: Date | null
  today: Date
  onDateClick: (d: Date) => void
  onDateHover: (d: Date | null) => void
  /**
   * Days the listing is unavailable, as local `YYYY-MM-DD` keys (build them
   * with toLocalISODate, never `toISOString()` — see calendarUtils). Drives
   * STYLING ONLY: a blocked day is struck through, but whether it can be
   * clicked is decided entirely by `isDisabled`. That split matters — a blocked
   * day is still a legal RETURN date, because is_listing_available() excludes
   * the return day (`blocked_on between p_from and p_to - 1`). Treating blocked
   * as automatically unclickable made this calendar reject Sept 8 → Sept 10
   * against a Sept 10 block, a range the database accepts.
   * Omitted by the search bar, which spans every listing and so has no single
   * availability to show.
   */
  blockedDates?: Set<string>
  /**
   * The single source of truth for what can't be clicked right now — both
   * genuinely unavailable days and merely out-of-range ones (e.g. dates past
   * the first blocked day once a pickup date is chosen). A day that is blocked
   * but NOT disabled renders as selectable-for-return.
   */
  isDisabled?: (d: Date) => boolean
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const rangeEnd = endDate ?? hoverDate

  return (
    <div className="flex-1 min-w-0">
      <p className="text-center font-bold text-base mb-5">{MONTH_NAMES[month]} {year}</p>
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((l, i) => (
          <div key={i} className="text-center text-xs font-medium text-gray-400 py-1">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDay }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = new Date(year, month, i + 1)
          const isPast = date.getTime() < today.getTime() && !isSameDay(date, today)
          const isBlocked = blockedDates?.has(toLocalISODate(date)) ?? false
          const isLocked = isDisabled?.(date) ?? false
          const unpickable = isPast || isLocked
          // Blocked, yet still clickable: the only way that happens is as the
          // return day of the range being picked. Say so rather than showing a
          // struck-through day that mysteriously responds to clicks.
          const returnOnly = isBlocked && !unpickable
          const isStart = !!startDate && isSameDay(date, startDate)
          const isEnd = !!endDate && isSameDay(date, endDate)
          // Once a day is one of the chosen endpoints it must read as chosen.
          // Without this, a return day that is also blocked kept its grey
          // struck-through treatment and competed with the navy selected pill —
          // two conflicting background utilities whose winner is decided by
          // stylesheet order, not by the order they appear in this array.
          const isSelected = isStart || isEnd
          const isHover = !!hoverDate && isSameDay(date, hoverDate) && !endDate
          const inRange = !!startDate && !!rangeEnd && isBetween(date, startDate, rangeEnd)
          const isRangeStart = isStart && !!(endDate || hoverDate)
          const isRangeEnd = isEnd || (isHover && !!startDate && !endDate)

          return (
            <div
              key={i}
              className={[
                'relative h-10 flex items-center justify-center',
                inRange ? 'bg-gray-100' : '',
                isRangeStart && !isRangeEnd ? 'rounded-l-full' : '',
                isRangeEnd && !isRangeStart ? 'rounded-r-full' : '',
              ].join(' ')}
              onClick={() => !unpickable && onDateClick(date)}
              onMouseEnter={() => !unpickable && onDateHover(date)}
              onMouseLeave={() => onDateHover(null)}
            >
              <span
                aria-disabled={unpickable || undefined}
                title={
                  returnOnly
                    ? 'Return day only — the gear is booked from this day, but you can hand it back that morning'
                    : isBlocked
                      ? 'Unavailable — already booked or blocked by the host'
                      : undefined
                }
                className={[
                  'w-9 h-9 flex items-center justify-center rounded-full text-sm transition-colors',
                  isPast ? 'text-gray-300 cursor-default' : '',
                  isBlocked && !isPast && !returnOnly && !isSelected ? 'text-gray-400 line-through bg-gray-100 cursor-not-allowed' : '',
                  returnOnly && !isSelected ? 'text-gray-500 line-through bg-gray-100 cursor-pointer hover:ring-2 hover:ring-[#003049]/30' : '',
                  isLocked && !isPast && !isBlocked && !isSelected ? 'text-gray-300 cursor-not-allowed' : '',
                  !unpickable ? 'cursor-pointer' : '',
                  isSelected ? 'bg-[#003049] text-white font-semibold cursor-pointer' : '',
                  isHover && !isStart ? 'bg-gray-200 text-gray-800' : '',
                  !unpickable && !isStart && !isEnd && !isHover ? 'hover:bg-gray-100 text-gray-800' : '',
                  isSameDay(date, today) && !isStart && !isEnd ? 'font-bold' : '',
                ].join(' ')}
              >
                {i + 1}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
