import type { RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CalendarMonth } from './CalendarMonth'
import { FLEX_OPTIONS } from './searchBarData'

export function WhenPanel({
  calRef, style,
  calMode, setCalMode,
  startDate, endDate, hoverDate, onDateClick, onDateHover,
  today,
  leftYear, leftMonth, rightYear, rightMonth, prevMonth, nextMonth,
  flexibility, setFlexibility,
  flexDuration, setFlexDuration,
  flexMonth, setFlexMonth,
}: {
  calRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  calMode: 'Dates' | 'Flexible'
  setCalMode: (mode: 'Dates' | 'Flexible') => void
  startDate: Date | null
  endDate: Date | null
  hoverDate: Date | null
  onDateClick: (d: Date) => void
  onDateHover: (d: Date | null) => void
  today: Date
  leftYear: number
  leftMonth: number
  rightYear: number
  rightMonth: number
  prevMonth: () => void
  nextMonth: () => void
  flexibility: string
  setFlexibility: (v: string) => void
  flexDuration: string | null
  setFlexDuration: (v: string | null) => void
  flexMonth: number | null
  setFlexMonth: (v: number | null) => void
}) {
  return (
    <div ref={calRef} style={style} className="animate-dropdown bg-white rounded-3xl shadow-2xl p-8">
      {/* Dates / Flexible toggle */}
      <div className="flex justify-center mb-8">
        <div className="flex bg-gray-100 rounded-full p-1">
          {(['Dates', 'Flexible'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setCalMode(mode)}
              className={`px-10 py-2 rounded-full text-sm font-medium transition-all ${
                calMode === mode ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {calMode === 'Dates' ? (
        <>
          <div className="flex gap-6 relative">
            <button
              type="button"
              onClick={prevMonth}
              className="absolute -left-2 top-0 p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>

            <CalendarMonth
              year={leftYear} month={leftMonth}
              startDate={startDate} endDate={endDate} hoverDate={hoverDate}
              today={today}
              onDateClick={onDateClick}
              onDateHover={onDateHover}
            />

            <div className="w-px bg-gray-100 shrink-0" />

            <CalendarMonth
              year={rightYear} month={rightMonth}
              startDate={startDate} endDate={endDate} hoverDate={hoverDate}
              today={today}
              onDateClick={onDateClick}
              onDateHover={onDateHover}
            />

            <button
              type="button"
              onClick={nextMonth}
              className="absolute -right-2 top-0 p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>

          <div className="flex gap-2 mt-8 flex-wrap">
            {FLEX_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setFlexibility(opt)}
                className={`px-4 py-1.5 rounded-full border text-sm transition-colors ${
                  flexibility === opt
                    ? 'border-gray-900 font-semibold text-gray-900'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div>
          {/* How long */}
          <p className="text-center text-xl font-bold text-gray-900 mb-5">How long would you like to rent?</p>
          <div className="flex justify-center gap-3 mb-10">
            {['Weekend', 'Week', 'Month'].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setFlexDuration(flexDuration === d ? null : d)}
                className={`px-7 py-3 rounded-full border text-sm font-medium transition-colors ${
                  flexDuration === d
                    ? 'border-gray-900 text-gray-900 font-semibold'
                    : 'border-gray-200 text-gray-700 hover:border-gray-400'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Go anytime */}
          <p className="text-center text-xl font-bold text-gray-900 mb-5">Go anytime</p>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(today.getFullYear(), today.getMonth() + 1 + i, 1)
              const monthIdx = today.getMonth() + 1 + i
              const isSelected = flexMonth === monthIdx
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFlexMonth(isSelected ? null : monthIdx)}
                  className={`shrink-0 w-36 h-36 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 transition-colors ${
                    isSelected
                      ? 'border-gray-900 bg-white'
                      : 'border-gray-200 bg-white hover:border-gray-400'
                  }`}
                >
                  <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                  </svg>
                  <span className="font-semibold text-gray-900 text-sm">
                    {d.toLocaleDateString('en-US', { month: 'long' })}
                  </span>
                  <span className="text-gray-500 text-xs">{d.getFullYear()}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
