'use client'

import { Search, MapPin, Calendar, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export function CompactSearchBar() {
  const router = useRouter()
  const params = useSearchParams()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [city, setCity] = useState(params.get('city') ?? '')
  const [from, setFrom] = useState(params.get('from') ?? '')
  const [to, setTo] = useState(params.get('to') ?? '')
  const [active, setActive] = useState<string | null>(null)

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (query) p.set('q', query)
    if (city) p.set('city', city)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    router.push(`/search?${p.toString()}`)
  }

  function dateLabel() {
    if (from && to) return `${from} → ${to}`
    if (from) return from
    return 'Any dates'
  }

  return (
    <form
      onSubmit={handleSearch}
      className="flex items-center bg-white rounded-full border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
    >
      {/* What */}
      <div
        className={`flex items-center gap-2 px-5 py-2.5 flex-1 min-w-0 rounded-full transition-colors ${active === 'what' ? 'bg-gray-50' : ''}`}
        onClick={() => setActive('what')}
      >
        <Search className="w-4 h-4 text-[#003049] shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setActive('what')}
          onBlur={() => setActive(null)}
          placeholder="What are you looking for?"
          className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="shrink-0">
            <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      <div className={`w-px h-5 bg-gray-200 shrink-0 transition-opacity ${active === 'what' || active === 'where' ? 'opacity-0' : ''}`} />

      {/* Where */}
      <div
        className={`flex items-center gap-2 px-5 py-2.5 w-40 min-w-0 rounded-full transition-colors ${active === 'where' ? 'bg-gray-50' : ''}`}
        onClick={() => setActive('where')}
      >
        <MapPin className="w-4 h-4 text-[#003049] shrink-0" />
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          onFocus={() => setActive('where')}
          onBlur={() => setActive(null)}
          placeholder="Location"
          className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
        />
        {city && (
          <button type="button" onClick={() => setCity('')} className="shrink-0">
            <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      <div className={`w-px h-5 bg-gray-200 shrink-0 transition-opacity ${active === 'where' || active === 'when' ? 'opacity-0' : ''}`} />

      {/* When */}
      <div
        className={`flex items-center gap-2 px-5 py-2.5 rounded-full transition-colors ${active === 'when' ? 'bg-gray-50' : ''}`}
        onClick={() => setActive('when')}
      >
        <Calendar className="w-4 h-4 text-[#003049] shrink-0" />
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            onFocus={() => setActive('when')}
            onBlur={() => setActive(null)}
            className="text-gray-700 outline-none bg-transparent w-28 cursor-pointer"
          />
          <span className="text-gray-300">→</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            onFocus={() => setActive('when')}
            onBlur={() => setActive(null)}
            className="text-gray-700 outline-none bg-transparent w-28 cursor-pointer"
          />
        </div>
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo('') }} className="shrink-0">
            <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      {/* Search button */}
      <div className="pr-1.5 pl-2 shrink-0">
        <button
          type="submit"
          className={`flex items-center gap-2 rounded-full bg-[#003049] hover:bg-[#002438] text-white transition-all duration-200 ${
            query || city || from ? 'px-4 py-2 text-sm font-semibold' : 'w-9 h-9 justify-center'
          }`}
        >
          <Search className="w-4 h-4 shrink-0" />
          {(query || city || from) && <span>Search</span>}
        </button>
      </div>
    </form>
  )
}
