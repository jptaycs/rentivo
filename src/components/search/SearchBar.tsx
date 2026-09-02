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

const VARIANT = {
  hero: {
    container: 'rounded-full',
    fieldPadding: 'px-8 py-4',
    label: 'text-xs font-bold text-gray-900 mb-0.5',
    inputText: 'text-sm text-gray-500 placeholder-gray-400',
    whenValueText: 'text-sm',
    shadow: (active: boolean) => (active ? 'shadow-2xl' : 'shadow-xl hover:shadow-2xl'),
    searchBtnIdle: 'w-14 h-14 justify-center',
    searchBtnActive: 'px-5 h-14 text-sm font-semibold',
    searchIcon: 'w-5 h-5',
    clearBtn: 'w-5 h-5',
    clearIcon: 'w-3 h-3',
  },
  compact: {
    container: 'rounded-full border border-gray-200',
    fieldPadding: 'px-5 py-2.5',
    label: 'text-[10px] font-bold text-gray-900 mb-0.5 uppercase tracking-wide',
    inputText: 'text-sm text-gray-800 placeholder-gray-400',
    whenValueText: 'text-sm',
    shadow: (active: boolean) => (active ? 'shadow-md' : 'shadow-sm hover:shadow-md'),
    searchBtnIdle: 'w-9 h-9 justify-center',
    searchBtnActive: 'px-4 py-2 text-sm font-semibold',
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
        className={`bg-white ${styles.container} flex items-center transition-all duration-300 ${styles.shadow(!!activeField)}`}
      >
        {/* What */}
        <div
          ref={whatDivRef}
          onClick={openWhat}
          className={`relative flex-1 flex items-center gap-2 ${styles.fieldPadding} rounded-full cursor-text transition-all duration-200 ${
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

        <div className={`w-px h-6 bg-gray-200 shrink-0 transition-opacity duration-200 ${activeField === 'what' || activeField === 'where' ? 'opacity-0' : 'opacity-100'}`} />

        {/* Where */}
        <div
          ref={whereDivRef}
          onClick={openWhere}
          className={`relative flex-1 flex items-center gap-2 ${styles.fieldPadding} rounded-full cursor-text transition-all duration-200 ${
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

        <div className={`w-px h-6 bg-gray-200 shrink-0 transition-opacity duration-200 ${activeField === 'where' || activeField === 'when' ? 'opacity-0' : 'opacity-100'}`} />

        {/* When */}
        <button
          ref={whenBtnRef}
          type="button"
          onClick={openCalendar}
          className={`relative flex-1 flex items-center justify-between ${styles.fieldPadding} rounded-full text-left transition-all duration-200 ${
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
        <div className="pr-2 pl-2 shrink-0">
          <button
            type="submit"
            className={`flex items-center gap-2 rounded-full bg-[#003049] hover:bg-[#002438] active:scale-95 text-white transition-all duration-200 ${
              query || location || startDate ? styles.searchBtnActive : styles.searchBtnIdle
            }`}
          >
            <Search className={`${styles.searchIcon} shrink-0`} />
            {(query || location || startDate) && <span className="hidden sm:block">Search</span>}
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
