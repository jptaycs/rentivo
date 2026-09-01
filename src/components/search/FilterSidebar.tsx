'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Star, X } from 'lucide-react'

const CATEGORIES = [
  { value: 'mirrorless', label: 'Mirrorless Cameras' },
  { value: 'dslr', label: 'DSLR Cameras' },
  { value: 'digital', label: 'Digital Cameras' },
  { value: 'cinema', label: 'Cinema Cameras' },
  { value: 'smartphone', label: 'Smartphones' },
  { value: 'lens', label: 'Lenses' },
  { value: 'bundle', label: 'Creator Bundles' },
]

const BRANDS = ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Apple', 'Samsung', 'Panasonic', 'Blackmagic']

const PRICE_RANGES = [
  { label: 'Under ₱500', min: 0, max: 500 },
  { label: '₱500 – ₱1,500', min: 500, max: 1500 },
  { label: '₱1,500 – ₱3,000', min: 1500, max: 3000 },
  { label: '₱3,000 – ₱5,000', min: 3000, max: 5000 },
  { label: '₱5,000+', min: 5000, max: 99999 },
]

const RATINGS = [4.9, 4.8, 4.5, 4.0]

interface FilterSidebarProps {
  onClose?: () => void
}

export function FilterSidebar({ onClose }: FilterSidebarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const get = useCallback((key: string) => searchParams.get(key) ?? '', [searchParams])

  const update = useCallback(
    (key: string, value: string) => {
      const p = new URLSearchParams(searchParams.toString())
      if (value) p.set(key, value)
      else p.delete(key)
      router.push(`/search?${p.toString()}`)
    },
    [router, searchParams]
  )

  const toggle = useCallback(
    (key: string, value: string) => {
      const cur = get(key)
      update(key, cur === value ? '' : value)
    },
    [get, update]
  )

  const resetAll = () => {
    const q = get('q')
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
  }

  const hasFilters =
    get('category') || get('brand') || get('min_price') || get('instant_book') ||
    get('verified') || get('min_rating')

  return (
    <aside className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-[#111827]">Filters</h3>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={resetAll}
              className="text-xs text-[#003049] hover:underline font-medium"
            >
              Reset all
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="md:hidden">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Category */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Equipment Type</p>
        <div className="space-y-1.5">
          {CATEGORIES.map((cat) => (
            <label key={cat.value} className="flex items-center gap-2.5 cursor-pointer group">
              <input
                type="radio"
                name="category"
                checked={get('category') === cat.value}
                onChange={() => toggle('category', cat.value)}
                className="accent-[#003049] w-3.5 h-3.5"
              />
              <span className="text-sm text-gray-700 group-hover:text-[#003049] transition-colors">
                {cat.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Brand */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Brand</p>
        <div className="flex flex-wrap gap-1.5">
          {BRANDS.map((b) => (
            <button
              key={b}
              onClick={() => toggle('brand', b)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                get('brand') === b
                  ? 'bg-[#003049] border-[#003049] text-white font-semibold'
                  : 'border-gray-200 text-gray-600 hover:border-[#003049] hover:text-[#003049]'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Price Range */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Price Range / Day</p>
        <div className="space-y-1.5">
          {PRICE_RANGES.map((r) => {
            const active = get('min_price') === String(r.min) && get('max_price') === String(r.max)
            return (
              <label key={r.label} className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="price"
                  checked={active}
                  onChange={() => {
                    const p = new URLSearchParams(searchParams.toString())
                    if (active) { p.delete('min_price'); p.delete('max_price') }
                    else { p.set('min_price', String(r.min)); p.set('max_price', String(r.max)) }
                    router.push(`/search?${p.toString()}`)
                  }}
                  className="accent-[#003049] w-3.5 h-3.5"
                />
                <span className="text-sm text-gray-700 group-hover:text-[#003049] transition-colors">
                  {r.label}
                </span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Options</p>

        {[
          { key: 'instant_book', label: 'Instant Book' },
          { key: 'verified', label: 'Verified Hosts Only' },
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-700">{label}</span>
            <div
              onClick={() => toggle(key, '1')}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                get(key) === '1' ? 'bg-[#003049]' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  get(key) === '1' ? 'translate-x-5' : ''
                }`}
              />
            </div>
          </label>
        ))}
      </div>

      {/* Min Rating */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Min Rating</p>
        <div className="space-y-1.5">
          {RATINGS.map((r) => (
            <label key={r} className="flex items-center gap-2.5 cursor-pointer group">
              <input
                type="radio"
                name="rating"
                checked={get('min_rating') === String(r)}
                onChange={() => toggle('min_rating', String(r))}
                className="accent-[#003049] w-3.5 h-3.5"
              />
              <span className="flex items-center gap-1 text-sm text-gray-700 group-hover:text-[#003049] transition-colors">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {r}+
              </span>
            </label>
          ))}
        </div>
      </div>
    </aside>
  )
}
