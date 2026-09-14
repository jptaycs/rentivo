'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toMidnight, isSameDay, parseDateParam, toLocalISODate } from './calendarUtils'
import { WhatPanel } from './WhatPanel'
import { WherePanel } from './WherePanel'
import { WhenPanel } from './WhenPanel'
import { SUGGESTIONS } from './searchBarData'

// Tailwind's `sm` breakpoint — below it the fields stack into rows.
const MOBILE_BREAKPOINT = 640

const VARIANT = {
  hero: {
    container: 'rounded-3xl sm:rounded-full',
    fieldPadding: 'px-4 sm:px-8 py-3 sm:py-4',
    label: 'text-xs font-bold text-gray-900 mb-0.5',
    inputText: 'text-sm text-gray-500 placeholder-gray-400',
    whenValueText: 'text-sm',
    shadow: (active: boolean) => (active ? 'shadow-2xl' : 'shadow-xl hover:shadow-2xl'),
    searchBtnIdle: 'sm:w-14 sm:h-14',
    searchBtnActive: 'sm:w-auto sm:px-5 sm:h-14 sm:text-sm sm:font-semibold',
    searchIcon: 'w-5 h-5',
    clearBtn: 'w-5 h-5',
    clearIcon: 'w-3 h-3',
  },
  compact: {
    container: 'rounded-2xl sm:rounded-full border border-gray-200',
    fieldPadding: 'px-5 py-2.5',
    label: 'text-[10px] font-bold text-gray-900 mb-0.5 uppercase tracking-wide',
    inputText: 'text-sm text-gray-800 placeholder-gray-400',
    whenValueText: 'text-sm',
    shadow: (active: boolean) => (active ? 'shadow-md' : 'shadow-sm hover:shadow-md'),
    searchBtnIdle: 'sm:w-9 sm:h-9',
    searchBtnActive: 'sm:w-auto sm:h-auto sm:px-4 sm:py-2 sm:text-sm sm:font-semibold',
    searchIcon: 'w-4 h-4',
    clearBtn: 'w-4 h-4',
    clearIcon: 'w-2.5 h-2.5',
  },
} as const

interface SearchBarProps {
  variant: 'hero' | 'compact'
  initialQuery?: string
  initialCity?: string
  initialFrom?: string
  initialTo?: string
}

export function SearchBar({ variant, initialQuery = '', initialCity = '', initialFrom, initialTo }: SearchBarProps) {
  const styles = VARIANT[variant]
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [location, setLocation] = useState(initialCity)
  const [startDate, setStartDate] = useState<Date | null>(() => parseDateParam(initialFrom))
  const [endDate, setEndDate] = useState<Date | null>(() => parseDateParam(initialTo))
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
  const initialAnchor = startDate ?? today
  const [leftYear, setLeftYear] = useState(initialAnchor.getFullYear())
  const [leftMonth, setLeftMonth] = useState(initialAnchor.getMonth())
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

  // Where a dropdown panel should sit. On desktop it hangs under its own
  // field; on a phone the fields are stacked, so a panel under the Where row
  // would cover the When row (and swallow taps meant for it) — there every
  // panel hangs under the whole form instead.
  function panelPosition(field: HTMLElement | null, maxWidth: number) {
    const stacked = window.innerWidth < MOBILE_BREAKPOINT
    const anchor = stacked ? formRef.current : field
    if (!anchor) return null
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(maxWidth, window.innerWidth * 0.95)
    let left = rect.left + rect.width / 2 - width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    const top = rect.bottom + 8
    // Keep the panel inside the viewport (it scrolls internally instead).
    const maxHeight = Math.max(240, window.innerHeight - top - 16)
    return { top, left, width, maxHeight }
  }

  useEffect(() => {
    function reposition() {
      if (whatOpen) {
        const pos = panelPosition(whatDivRef.current, 380)
        if (pos) setWhatStyle(s => ({ ...s, ...pos, overflowY: 'auto' }))
      }
      if (whereOpen) {
        const pos = panelPosition(whereDivRef.current, 380)
        if (pos) setWhereStyle(s => ({ ...s, ...pos, overflowY: 'auto' }))
      }
      if (calOpen) {
        const pos = panelPosition(whenBtnRef.current, 760)
        if (pos) setCalStyle(s => ({ ...s, ...pos, overflowY: 'auto' }))
      }
    }
    window.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [whatOpen, whereOpen, calOpen])

  function closeAll() {
    setCalOpen(false)
    setWhereOpen(false)
    setWhatOpen(false)
    setActiveField(null)
  }

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      const inForm = formRef.current?.contains(e.target as Node)
      const inCal = calRef.current?.contains(e.target as Node)
      const inWhere = wherePanelRef.current?.contains(e.target as Node)
      const inWhat = whatPanelRef.current?.contains(e.target as Node)
      if (!inForm && !inCal && !inWhere && !inWhat) {
        closeAll()
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && (calOpen || whereOpen || whatOpen)) {
        closeAll()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [calOpen, whereOpen, whatOpen])

  function openCalendar() {
    if (calOpen) {
      closeAll()
      return
    }
    const pos = panelPosition(whenBtnRef.current, 760)
    if (pos) setCalStyle({ position: 'fixed', ...pos, overflowY: 'auto', zIndex: 99999 })
    // The When field is a button, so tapping it never blurs-and-closes the
    // What/Where panels on its own — close them explicitly.
    whatInputRef.current?.blur()
    whereInputRef.current?.blur()
    setWhatOpen(false)
    setWhereOpen(false)
    setCalOpen(true)
    setActiveField('when')
  }

  function openWhat() {
    const pos = panelPosition(whatDivRef.current, 380)
    if (pos) setWhatStyle({ position: 'fixed', ...pos, overflowY: 'auto', zIndex: 99999 })
    setWhatOpen(true)
    setActiveField('what')
    setCalOpen(false)
    setWhereOpen(false)
    setTimeout(() => whatInputRef.current?.focus(), 0)
  }

  function openWhere() {
    const pos = panelPosition(whereDivRef.current, 380)
    if (pos) setWhereStyle({ position: 'fixed', ...pos, overflowY: 'auto', zIndex: 99999 })
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
    if (startDate) params.set('from', toLocalISODate(startDate))
    if (endDate) params.set('to', toLocalISODate(endDate))
    router.push(`/search?${params.toString()}`)
  }

  const whatPanel = (
    <WhatPanel
      query={query}
      panelRef={whatPanelRef}
      style={whatStyle}
      onSelectQuery={value => { setQuery(value); setWhatOpen(false); setActiveField(null) }}
      onNavigate={href => { setWhatOpen(false); setActiveField(null); router.push(href) }}
    />
  )

  const wherePanel = (
    <WherePanel
      location={location}
      panelRef={wherePanelRef}
      style={whereStyle}
      onSelectLocation={value => { setLocation(value); setWhereOpen(false); setActiveField(null) }}
    />
  )

  const calendarPanel = (
    <WhenPanel
      calRef={calRef}
      style={calStyle}
      calMode={calMode}
      setCalMode={setCalMode}
      startDate={startDate}
      endDate={endDate}
      hoverDate={hoverDate}
      onDateClick={handleDateClick}
      onDateHover={setHoverDate}
      today={today}
      leftYear={leftYear}
      leftMonth={leftMonth}
      rightYear={rightYear}
      rightMonth={rightMonth}
      prevMonth={prevMonth}
      nextMonth={nextMonth}
      flexibility={flexibility}
      setFlexibility={setFlexibility}
      flexDuration={flexDuration}
      setFlexDuration={setFlexDuration}
      flexMonth={flexMonth}
      setFlexMonth={setFlexMonth}
    />
  )

  return (
    <>
      <form
        ref={formRef}
        onSubmit={handleSearch}
        className={`bg-white ${styles.container} flex flex-col sm:flex-row items-stretch sm:items-center p-1.5 sm:p-0 transition-all duration-300 ${styles.shadow(!!activeField)}`}
      >
        {/* What */}
        <div
          ref={whatDivRef}
          onClick={openWhat}
          className={`relative w-full sm:w-auto sm:flex-1 min-w-0 flex items-center gap-2 ${styles.fieldPadding} rounded-2xl sm:rounded-full cursor-text transition-all duration-200 ${
            activeField === 'what' ? 'bg-white shadow-md' : activeField ? 'opacity-50 hover:opacity-75' : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex-1 min-w-0">
            <span className={`block ${styles.label}`}>What</span>
            <input
              ref={whatInputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={openWhat}
              placeholder="Search cameras, phones, lenses…"
              className={`${styles.inputText} outline-none bg-transparent w-full`}
            />
          </div>
          {query && (
            <button type="button" onClick={e => { e.stopPropagation(); setQuery('') }}
              className={`${styles.clearBtn} rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0`}>
              <X className={`${styles.clearIcon} text-gray-600`} />
            </button>
          )}
        </div>

        <div className={`h-px mx-4 sm:mx-0 sm:w-px sm:h-6 bg-gray-200 shrink-0 transition-opacity duration-200 ${activeField === 'what' || activeField === 'where' ? 'opacity-0' : 'opacity-100'}`} />

        {/* Where */}
        <div
          ref={whereDivRef}
          onClick={openWhere}
          className={`relative w-full sm:w-auto sm:flex-1 min-w-0 flex items-center gap-2 ${styles.fieldPadding} rounded-2xl sm:rounded-full cursor-text transition-all duration-200 ${
            activeField === 'where' ? 'bg-white shadow-md' : activeField ? 'opacity-50 hover:opacity-75' : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex-1 min-w-0">
            <span className={`block ${styles.label}`}>Where</span>
            <input
              ref={whereInputRef}
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onFocus={openWhere}
              placeholder="City, Province, Nearby"
              className={`${styles.inputText} outline-none bg-transparent w-full`}
            />
          </div>
          {location && (
            <button type="button" onClick={e => { e.stopPropagation(); setLocation('') }}
              className={`${styles.clearBtn} rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0`}>
              <X className={`${styles.clearIcon} text-gray-600`} />
            </button>
          )}
        </div>

        <div className={`h-px mx-4 sm:mx-0 sm:w-px sm:h-6 bg-gray-200 shrink-0 transition-opacity duration-200 ${activeField === 'where' || activeField === 'when' ? 'opacity-0' : 'opacity-100'}`} />

        {/* When */}
        <button
          ref={whenBtnRef}
          type="button"
          onClick={openCalendar}
          className={`relative w-full sm:w-auto sm:flex-1 min-w-0 flex items-center justify-between ${styles.fieldPadding} rounded-2xl sm:rounded-full text-left transition-all duration-200 ${
            activeField === 'when' ? 'bg-white shadow-md' : activeField ? 'opacity-50 hover:opacity-75' : 'hover:bg-gray-50'
          }`}
        >
          <div>
            <span className={`block ${styles.label}`}>When</span>
            <span className={`${styles.whenValueText} ${startDate ? 'text-gray-800' : 'text-gray-400'}`}>{whenLabel()}</span>
          </div>
          {(startDate || endDate) && (
            <span onClick={e => { e.stopPropagation(); setStartDate(null); setEndDate(null) }}
              className={`${styles.clearBtn} rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors shrink-0`}>
              <X className={`${styles.clearIcon} text-gray-600`} />
            </span>
          )}
        </button>

        {/* Search button — expands with label when fields are filled */}
        <div className="pt-1.5 sm:pt-0 sm:pr-2 sm:pl-2 shrink-0">
          {/* Phone: a full-width row. Desktop: the round button that widens to
              show its label once a field is filled. */}
          <button
            type="submit"
            className={`flex w-full items-center justify-center gap-2 rounded-full bg-[#003049] hover:bg-[#002438] active:scale-95 text-white transition-all duration-200 h-12 px-5 text-sm font-semibold sm:p-0 sm:font-normal ${
              query || location || startDate ? styles.searchBtnActive : styles.searchBtnIdle
            }`}
          >
            <Search className={`${styles.searchIcon} shrink-0`} />
            <span className={query || location || startDate ? '' : 'sm:hidden'}>Search</span>
          </button>
        </div>
      </form>

      {variant === 'hero' && (
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
      )}

      {mounted && whatOpen && createPortal(whatPanel, document.body)}
      {mounted && whereOpen && createPortal(wherePanel, document.body)}
      {mounted && calOpen && createPortal(calendarPanel, document.body)}
    </>
  )
}
