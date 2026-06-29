'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight as ChevronRightIcon, Info } from 'lucide-react'

interface Step4CalendarProps {
  blockedDates: string[]
  onChange: (dates: string[]) => void
  onNext: () => void
  onBack: () => void
}

function formatDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function Step4Calendar({ blockedDates, onChange, onNext, onBack }: Step4CalendarProps) {
  const today = new Date()
  const [viewYear, setViewYear]   = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  function toggleDate(dateStr: string) {
    if (blockedDates.includes(dateStr)) {
      onChange(blockedDates.filter(d => d !== dateStr))
    } else {
      onChange([...blockedDates, dateStr])
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const firstDay  = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const monthName = new Date(viewYear, viewMonth).toLocaleString('en-PH', { month: 'long', year: 'numeric' })

  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Set your availability</h2>
        <p className="text-gray-500 text-sm mt-1">Click dates to mark them as unavailable. Leave all clear if you're available anytime.</p>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={prevMonth} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="font-bold text-[#111827]">{monthName}</h3>
          <button onClick={nextMonth} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-bold text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = formatDate(viewYear, viewMonth, day)
            const isPast  = new Date(dateStr) < new Date(today.toDateString())
            const blocked = blockedDates.includes(dateStr)
            const isToday = dateStr === formatDate(today.getFullYear(), today.getMonth(), today.getDate())

            return (
              <button
                key={day}
                disabled={isPast}
                onClick={() => !isPast && toggleDate(dateStr)}
                className={`mx-auto w-9 h-9 rounded-full text-sm font-medium transition-all flex items-center justify-center ${
                  isPast   ? 'text-gray-200 cursor-not-allowed' :
                  blocked  ? 'bg-red-100 text-red-600 hover:bg-red-200' :
                  isToday  ? 'ring-2 ring-[#2563EB] text-[#2563EB] font-bold hover:bg-blue-50' :
                             'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-red-100 border border-red-200" /> Blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full ring-2 ring-[#2563EB]" /> Today
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-white border border-gray-200" /> Available
        </span>
      </div>

      {blockedDates.length > 0 && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-[#2563EB]">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{blockedDates.length} date{blockedDates.length > 1 ? 's' : ''} marked as unavailable.</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 bg-[#2563EB] hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          Continue <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
