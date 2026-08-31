'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronLeft, ChevronRight, MapPin, Navigation, Clock, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

const SUGGESTIONS = ['Sony A7 IV', 'Canon EOS R6', 'Nikon Z8', 'Fujifilm X100VI', 'iPhone 16 Pro Max', 'Samsung Galaxy S25 Ultra', 'Sony 24-70mm GM II']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['S','M','T','W','T','F','S']
const FLEX_OPTIONS = ['Exact dates','± 1 day','± 2 days','± 3 days','± 7 days','± 14 days']

const RECENT_EQUIPMENT = [
  { name: 'Sony A7 IV', detail: 'Full-frame mirrorless' },
  { name: 'iPhone 16 Pro Max', detail: 'Smartphone' },
  { name: 'Canon RF 24-70mm f/2.8', detail: 'Lens' },
]
const SUGGESTED_CATEGORIES = [
  { label: 'Cameras', detail: 'Mirrorless, DSLR & Cinema', emoji: '📷', href: '/search?category=mirrorless' },
  { label: 'Phones', detail: 'iOS & Android', emoji: '📱', href: '/search?category=smartphone' },
  { label: 'Lenses', detail: 'Prime & Zoom', emoji: '🎯', href: '/search?category=lens' },
  { label: 'Creator Kits', detail: 'Complete bundles', emoji: '🎥', href: '/search?category=bundle' },
]

const RECENT_SEARCHES = [
  { city: 'Manila', detail: 'Jun 30 – Jul 7' },
  { city: 'Cebu City', detail: 'Jul 1 – 5' },
  { city: 'Davao City', detail: 'Jul 15 – 20' },
]
const SUGGESTED_DESTINATIONS = [
  { city: 'Nearby', detail: 'Find gear around you', type: 'nearby' as const },
  { city: 'Manila, Philippines', detail: 'Most listings available', type: 'city' as const },
  { city: 'Cebu City, Philippines', detail: 'Growing creator community', type: 'city' as const },
  { city: 'Davao City, Philippines', detail: 'Great for outdoor shoots', type: 'city' as const },
  { city: 'Quezon City, Philippines', detail: 'Film and studio hub', type: 'city' as const },
]

function toMidnight(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function isBetween(d: Date, start: Date, end: Date) {
  const t = d.getTime(), s = start.getTime(), e = end.getTime()
  return t > Math.min(s, e) && t < Math.max(s, e)
}

function CalendarMonth({
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

export function HeroSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [hoverDate, setHoverDate] = useState<Date | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [calMode, setCalMode] = useState<'Dates' | 'Flexible'>('Dates')
  const [flexibility, setFlexibility] = useState('Exact dates')
  const [flexDuration, setFlexDuration] = useState<string | null>(null)
  const [flexMonth, setFlexMonth] = useState<number | null>(null)
  const [activeField, setActiveField] = useState<string | null>(null)
  const [calStyle, setCalStyle] = useState<React.CSSProperties>({})
  const [whereOpen, setWhereOpen] = useState(false)
  const [whereStyle, setWhereStyle] = useState<React.CSSProperties>({})
  const [whatOpen, setWhatOpen] = useState(false)
  const [whatStyle, setWhatStyle] = useState<React.CSSProperties>({})
  const [mounted, setMounted] = useState(false)

  const today = toMidnight(new Date())
  const [leftYear, setLeftYear] = useState(today.getFullYear())
  const [leftMonth, setLeftMonth] = useState(today.getMonth())
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear

  const formRef = useRef<HTMLFormElement>(null)
  const calRef = useRef<HTMLDivElement>(null)
  const wherePanelRef = useRef<HTMLDivElement>(null)
  const whereDivRef = useRef<HTMLDivElement>(null)
  const whereInputRef = useRef<HTMLInputElement>(null)
  const whatPanelRef = useRef<HTMLDivElement>(null)
  const whatDivRef = useRef<HTMLDivElement>(null)
  const whatInputRef = useRef<HTMLInputElement>(null)
  const whenBtnRef = useRef<HTMLButtonElement>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard mounted-flag pattern; no test suite to safely verify a rewrite (see AGENTS.md)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    function reposition() {
      if (whatOpen && whatDivRef.current) {
        const rect = whatDivRef.current.getBoundingClientRect()
        const panelWidth = Math.min(380, window.innerWidth * 0.95)
        let left = rect.left + rect.width / 2 - panelWidth / 2
        left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))
        setWhatStyle(s => ({ ...s, top: rect.bottom + 8, left }))
      }
      if (whereOpen && whereDivRef.current) {
        const rect = whereDivRef.current.getBoundingClientRect()
        const panelWidth = Math.min(380, window.innerWidth * 0.95)
        let left = rect.left + rect.width / 2 - panelWidth / 2
        left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))
        setWhereStyle(s => ({ ...s, top: rect.bottom + 8, left }))
      }
      if (calOpen && whenBtnRef.current) {
        const rect = whenBtnRef.current.getBoundingClientRect()
        const calWidth = Math.min(760, window.innerWidth * 0.95)
        let left = rect.left + rect.width / 2 - calWidth / 2
        left = Math.max(8, Math.min(left, window.innerWidth - calWidth - 8))
        setCalStyle(s => ({ ...s, top: rect.bottom + 8, left }))
      }
    }
    window.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [whatOpen, whereOpen, calOpen])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      const inForm = formRef.current?.contains(e.target as Node)
      const inCal = calRef.current?.contains(e.target as Node)
      const inWhere = wherePanelRef.current?.contains(e.target as Node)
      const inWhat = whatPanelRef.current?.contains(e.target as Node)
      if (!inForm && !inCal && !inWhere && !inWhat) {
        setCalOpen(false)
        setWhereOpen(false)
        setWhatOpen(false)
        setActiveField(null)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  function openCalendar() {
    if (whenBtnRef.current) {
      const rect = whenBtnRef.current.getBoundingClientRect()
      const calWidth = Math.min(760, window.innerWidth * 0.95)
      let left = rect.left + rect.width / 2 - calWidth / 2
      left = Math.max(8, Math.min(left, window.innerWidth - calWidth - 8))
      setCalStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left,
        width: calWidth,
        zIndex: 99999,
      })
    }
    setCalOpen(v => !v)
    setActiveField('when')
  }

  function openWhat() {
    if (whatDivRef.current) {
      const rect = whatDivRef.current.getBoundingClientRect()
      const panelWidth = Math.min(380, window.innerWidth * 0.95)
      let left = rect.left + rect.width / 2 - panelWidth / 2
      left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))
      setWhatStyle({ position: 'fixed', top: rect.bottom + 8, left, width: panelWidth, zIndex: 99999 })
    }
    setWhatOpen(true)
    setActiveField('what')
    setCalOpen(false)
    setWhereOpen(false)
    setTimeout(() => whatInputRef.current?.focus(), 0)
  }

  function openWhere() {
    if (whereDivRef.current) {
      const rect = whereDivRef.current.getBoundingClientRect()
      const panelWidth = Math.min(380, window.innerWidth * 0.95)
      let left = rect.left + rect.width / 2 - panelWidth / 2
      left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))
      setWhereStyle({ position: 'fixed', top: rect.bottom + 8, left, width: panelWidth, zIndex: 99999 })
    }
    setWhereOpen(true)
    setActiveField('where')
    setCalOpen(false)
    setWhatOpen(false)
  }

  function handleDateClick(date: Date) {
    if (!startDate || (startDate && endDate)) {
      setStartDate(date)
      setEndDate(null)
    } else {
      if (date.getTime() < startDate.getTime()) {
        setEndDate(startDate)
        setStartDate(date)
      } else if (isSameDay(date, startDate)) {
        setStartDate(null)
      } else {
        setEndDate(date)
        setTimeout(() => { setCalOpen(false); setActiveField(null) }, 150)
      }
    }
  }

  function prevMonth() {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1) }
    else setLeftMonth(m => m - 1)
  }
  function nextMonth() {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1) }
    else setLeftMonth(m => m + 1)
  }

  function formatDate(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function whenLabel() {
    if (startDate && endDate) return `${formatDate(startDate)} – ${formatDate(endDate)}`
    if (startDate) return formatDate(startDate)
    return 'Anytime'
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (location) params.set('city', location)
    if (startDate) params.set('from', startDate.toISOString().split('T')[0])
    if (endDate) params.set('to', endDate.toISOString().split('T')[0])
    router.push(`/search?${params.toString()}`)
  }

  const filteredEquipment = RECENT_EQUIPMENT.filter(e =>
    !query || e.name.toLowerCase().includes(query.toLowerCase())
  )
  const filteredCategories = SUGGESTED_CATEGORIES.filter(c =>
    !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.detail.toLowerCase().includes(query.toLowerCase())
  )

  const whatPanel = (
    <div ref={whatPanelRef} style={whatStyle} className="animate-dropdown bg-white rounded-2xl shadow-2xl py-4 overflow-hidden">
      {filteredEquipment.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">Recent searches</p>
          {filteredEquipment.map((e, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setQuery(e.name); setWhatOpen(false); setActiveField(null) }}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-gray-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{e.name}</p>
                <p className="text-xs text-gray-500">{e.detail}</p>
              </div>
            </button>
          ))}
          <div className="border-t border-gray-100 my-2" />
        </>
      )}
      {filteredCategories.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">Browse by category</p>
          {filteredCategories.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setQuery(c.label); setWhatOpen(false); setActiveField(null); router.push(c.href) }}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-xl">
                {c.emoji}
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.label}</p>
                <p className="text-xs text-gray-500">{c.detail}</p>
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  )

  const filteredSuggestions = SUGGESTED_DESTINATIONS.filter(s =>
    !location || s.city.toLowerCase().includes(location.toLowerCase())
  )

  const wherePanel = (
    <div ref={wherePanelRef} style={whereStyle} className="animate-dropdown bg-white rounded-2xl shadow-2xl py-4 overflow-hidden">
      {RECENT_SEARCHES.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">Recent searches</p>
          {RECENT_SEARCHES.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setLocation(s.city); setWhereOpen(false); setActiveField(null) }}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-gray-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{s.city}</p>
                <p className="text-xs text-gray-500">{s.detail}</p>
              </div>
            </button>
          ))}
          <div className="border-t border-gray-100 my-2" />
        </>
      )}
      <p className="text-xs font-semibold text-gray-500 px-5 py-2">Suggested destinations</p>
      {filteredSuggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { setLocation(s.type === 'nearby' ? '' : s.city); setWhereOpen(false); setActiveField(null) }}
          className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
        >
          <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            {s.type === 'nearby'
              ? <Navigation className="w-5 h-5 text-[#003049]" />
              : <MapPin className="w-5 h-5 text-[#003049]" />
            }
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{s.city}</p>
            <p className="text-xs text-gray-500">{s.detail}</p>
          </div>
        </button>
      ))}
    </div>
  )

  const calendarPanel = (
    <div ref={calRef} style={calStyle} className="animate-dropdown bg-white rounded-3xl shadow-2xl p-8">
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
              onDateClick={handleDateClick}
              onDateHover={setHoverDate}
            />

            <div className="w-px bg-gray-100 shrink-0" />

            <CalendarMonth
              year={rightYear} month={rightMonth}
              startDate={startDate} endDate={endDate} hoverDate={hoverDate}
              today={today}
              onDateClick={handleDateClick}
              onDateHover={setHoverDate}
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

  return (
    <section className="relative bg-[#003049]">
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight">
            Rent Professional<br className="hidden sm:block" />{' '}
            <span className="text-[#FDF0D5]">Cameras & Phones</span>
          </h1>
          <p className="mt-4 text-lg text-blue-100 max-w-xl mx-auto">
            Find the perfect camera, smartphone, or lens for your next shoot — from trusted owners near you.
          </p>
        </div>

        {/* Search pill */}
        <form
          ref={formRef}
          onSubmit={handleSearch}
          className={`bg-white rounded-full flex items-center transition-all duration-300 ${activeField ? 'shadow-2xl' : 'shadow-xl hover:shadow-2xl'}`}
        >
          {/* What */}
          <div
            ref={whatDivRef}
            onClick={openWhat}
            className={`relative flex-1 flex items-center gap-2 px-8 py-4 rounded-full cursor-text transition-all duration-200 ${
              activeField === 'what' ? 'bg-white shadow-md' : activeField ? 'opacity-50 hover:opacity-75' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-gray-900 mb-0.5">What</span>
              <input
                ref={whatInputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={openWhat}
                placeholder="Search cameras, phones, lenses…"
                className="text-sm text-gray-500 placeholder-gray-400 outline-none bg-transparent w-full"
              />
            </div>
            {query && (
              <button type="button" onClick={e => { e.stopPropagation(); setQuery('') }}
                className="w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0">
                <X className="w-3 h-3 text-gray-600" />
              </button>
            )}
          </div>

          <div className={`w-px h-6 bg-gray-200 shrink-0 transition-opacity duration-200 ${activeField === 'what' || activeField === 'where' ? 'opacity-0' : 'opacity-100'}`} />

          {/* Where */}
          <div
            ref={whereDivRef}
            onClick={openWhere}
            className={`relative flex-1 flex items-center gap-2 px-8 py-4 rounded-full cursor-text transition-all duration-200 ${
              activeField === 'where' ? 'bg-white shadow-md' : activeField ? 'opacity-50 hover:opacity-75' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-gray-900 mb-0.5">Where</span>
              <input
                ref={whereInputRef}
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                onFocus={openWhere}
                placeholder="City, Province, Nearby"
                className="text-sm text-gray-500 placeholder-gray-400 outline-none bg-transparent w-full"
              />
            </div>
            {location && (
              <button type="button" onClick={e => { e.stopPropagation(); setLocation('') }}
                className="w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0">
                <X className="w-3 h-3 text-gray-600" />
              </button>
            )}
          </div>

          <div className={`w-px h-6 bg-gray-200 shrink-0 transition-opacity duration-200 ${activeField === 'where' || activeField === 'when' ? 'opacity-0' : 'opacity-100'}`} />

          {/* When */}
          <button
            ref={whenBtnRef}
            type="button"
            onClick={openCalendar}
            className={`relative flex-1 flex items-center justify-between px-8 py-4 rounded-full text-left transition-all duration-200 ${
              activeField === 'when' ? 'bg-white shadow-md' : activeField ? 'opacity-50 hover:opacity-75' : 'hover:bg-gray-50'
            }`}
          >
            <div>
              <span className="block text-xs font-bold text-gray-900 mb-0.5">When</span>
              <span className={`text-sm ${startDate ? 'text-gray-800' : 'text-gray-400'}`}>{whenLabel()}</span>
            </div>
            {(startDate || endDate) && (
              <span onClick={e => { e.stopPropagation(); setStartDate(null); setEndDate(null) }}
                className="w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0">
                <X className="w-3 h-3 text-gray-600" />
              </span>
            )}
          </button>

          {/* Search button — expands with label when fields are filled */}
          <div className="pr-2 pl-2 shrink-0">
            <button
              type="submit"
              className={`flex items-center gap-2 rounded-full bg-[#003049] hover:bg-[#002438] active:scale-95 text-white transition-all duration-200 ${
                query || location || startDate ? 'px-5 h-14 text-sm font-semibold' : 'w-14 h-14 justify-center'
              }`}
            >
              <Search className="w-5 h-5 shrink-0" />
              {(query || location || startDate) && <span className="hidden sm:block">Search</span>}
            </button>
          </div>
        </form>

        {/* Quick suggestion chips */}
        <div className="mt-5 flex flex-wrap gap-2 justify-center">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              className="text-xs text-blue-100 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full px-3 py-1 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {mounted && whatOpen && createPortal(whatPanel, document.body)}
      {mounted && whereOpen && createPortal(wherePanel, document.body)}
      {mounted && calOpen && createPortal(calendarPanel, document.body)}
    </section>
  )
}
