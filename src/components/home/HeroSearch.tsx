'use client'

import { useState } from 'react'
import { Search, MapPin, Calendar } from 'lucide-react'
import { useRouter } from 'next/navigation'

const SUGGESTIONS = [
  'Sony A7 IV',
  'Canon EOS R6',
  'Nikon Z8',
  'Fujifilm X100VI',
  'iPhone 16 Pro Max',
  'Samsung Galaxy S25 Ultra',
  'Sony 24-70mm GM II',
]

export function HeroSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [pickupDate, setPickupDate] = useState('')
  const [returnDate, setReturnDate] = useState('')

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (location) params.set('city', location)
    if (pickupDate) params.set('from', pickupDate)
    if (returnDate) params.set('to', returnDate)
    router.push(`/search?${params.toString()}`)
  }

  return (
    <section className="relative bg-[#003049] overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24">
        {/* Headlines */}
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight">
            Rent Professional<br className="hidden sm:block" />{' '}
            <span className="text-[#F97316]">Cameras & Phones</span>
          </h1>
          <p className="mt-4 text-lg text-blue-100 max-w-xl mx-auto">
            Find the perfect camera, smartphone, or lens for your next shoot — from trusted owners near you.
          </p>
        </div>

        {/* Search pill */}
        <form
          onSubmit={handleSearch}
          className="bg-white rounded-2xl shadow-2xl flex flex-col md:flex-row md:items-center divide-y md:divide-y-0 md:divide-x divide-gray-200 overflow-hidden"
        >
          {/* What */}
          <div className="flex items-center gap-3 px-5 py-4 flex-1">
            <Search className="w-5 h-5 text-[#003049] shrink-0" />
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
                What
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sony A7 IV, iPhone 16 Pro Max…"
                className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
              />
            </div>
          </div>

          {/* Where */}
          <div className="flex items-center gap-3 px-5 py-4 flex-1">
            <MapPin className="w-5 h-5 text-[#003049] shrink-0" />
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
                Where
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Province or Nearby"
                className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
              />
            </div>
          </div>

          {/* When */}
          <div className="flex items-center gap-3 px-5 py-4 flex-1">
            <Calendar className="w-5 h-5 text-[#003049] shrink-0" />
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
                When
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={pickupDate}
                  onChange={(e) => setPickupDate(e.target.value)}
                  className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
                />
                <span className="text-gray-300 self-center">→</span>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
                />
              </div>
            </div>
          </div>

          {/* Search button */}
          <div className="px-3 py-3">
            <button
              type="submit"
              className="bg-[#003049] hover:bg-[#002438] active:bg-blue-800 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors flex items-center gap-2 w-full md:w-auto"
            >
              <Search className="w-4 h-4" />
              Search
            </button>
          </div>
        </form>

        {/* Quick suggestion chips */}
        <div className="mt-5 flex flex-wrap gap-2 justify-center">
          {SUGGESTIONS.map((s) => (
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
    </section>
  )
}
