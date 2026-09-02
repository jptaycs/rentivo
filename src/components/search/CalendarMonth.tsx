import { MONTH_NAMES, DAY_LABELS } from './searchBarData'
import { isSameDay, isBetween } from './calendarUtils'

export function CalendarMonth({
  year, month, startDate, endDate, hoverDate, today, onDateClick, onDateHover,
}: {
  year: number; month: number
  startDate: Date | null; endDate: Date | null; hoverDate: Date | null
  today: Date
  onDateClick: (d: Date) => void
  onDateHover: (d: Date | null) => void
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
          const isStart = !!startDate && isSameDay(date, startDate)
          const isEnd = !!endDate && isSameDay(date, endDate)
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
              onClick={() => !isPast && onDateClick(date)}
              onMouseEnter={() => !isPast && onDateHover(date)}
              onMouseLeave={() => onDateHover(null)}
            >
              <span className={[
                'w-9 h-9 flex items-center justify-center rounded-full text-sm transition-colors',
                isPast ? 'text-gray-300 cursor-default' : 'cursor-pointer',
                isStart || isEnd ? 'bg-[#003049] text-white font-semibold' : '',
                isHover && !isStart ? 'bg-gray-200 text-gray-800' : '',
                !isPast && !isStart && !isEnd && !isHover ? 'hover:bg-gray-100 text-gray-800' : '',
                isSameDay(date, today) && !isStart && !isEnd ? 'font-bold' : '',
              ].join(' ')}>
                {i + 1}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
