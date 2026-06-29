'use client'

import { Search, MapPin, Calendar, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'

export function CompactSearchBar() {
  const router = useRouter()
  const params = useSearchParams()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [city, setCity] = useState(params.get('city') ?? '')
  const [from, setFrom] = useState(params.get('from') ?? '')
  const [to, setTo] = useState(params.get('to') ?? '')

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (query) p.set('q', query)
    if (city) p.set('city', city)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    router.push(`/search?${p.toString()}`)
  }

  return (
    <form
      onSubmit={handleSearch}
      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-0 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-gray-200"
    >
      {/* What */}
      <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-0">
        <Search className="w-4 h-4 text-[#003049] shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search equipment…"
          className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')}>
            <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      {/* Where */}
      <div className="flex items-center gap-2 px-4 py-3 w-44 min-w-0">
        <MapPin className="w-4 h-4 text-[#003049] shrink-0" />
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Location"
          className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
        />
      </div>

      {/* When */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Calendar className="w-4 h-4 text-[#003049] shrink-0" />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="text-sm text-gray-700 outline-none bg-transparent w-32"
        />
        <span className="text-gray-300 text-xs">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="text-sm text-gray-700 outline-none bg-transparent w-32"
        />
      </div>

      <div className="px-3 py-2">
        <button
          type="submit"
          className="bg-[#003049] hover:bg-[#002438] text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors w-full sm:w-auto"
        >
          Search
        </button>
      </div>
    </form>
  )
}
