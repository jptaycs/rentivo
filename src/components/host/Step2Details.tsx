'use client'

import { ChevronRight, ChevronLeft, Plus, X } from 'lucide-react'

const CATEGORIES = [
  { value: 'mirrorless', label: 'Mirrorless Camera' },
  { value: 'dslr', label: 'DSLR Camera' },
  { value: 'cinema', label: 'Cinema Camera' },
  { value: 'smartphone', label: 'Smartphone' },
  { value: 'lens', label: 'Camera Lens' },
  { value: 'bundle', label: 'Creator Bundle' },
]

const CONDITIONS = [
  { value: 'mint', label: 'Mint', desc: 'Like new, no signs of use' },
  { value: 'excellent', label: 'Excellent', desc: 'Light use, perfect function' },
  { value: 'good', label: 'Good', desc: 'Normal wear, fully functional' },
  { value: 'fair', label: 'Fair', desc: 'Visible wear, works well' },
]

const BRANDS = ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Panasonic', 'Blackmagic', 'Apple', 'Samsung', 'Other']

interface DetailsData {
  category: string
  brand: string
  model: string
  serialNumber: string
  condition: string
  description: string
  accessories: string[]
}

interface Step2DetailsProps {
  data: DetailsData
  onChange: (data: DetailsData) => void
  onNext: () => void
  onBack: () => void
}

export function Step2Details({ data, onChange, onNext, onBack }: Step2DetailsProps) {
  function set<K extends keyof DetailsData>(key: K, value: DetailsData[K]) {
    onChange({ ...data, [key]: value })
  }

  function addAccessory(val: string) {
    if (!val.trim() || data.accessories.includes(val.trim())) return
    set('accessories', [...data.accessories, val.trim()])
  }

  function removeAccessory(i: number) {
    set('accessories', data.accessories.filter((_, idx) => idx !== i))
  }

  const canContinue = data.category && data.brand && data.model && data.condition && data.description.length >= 30

  const field = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100 transition-all bg-white'
  const label = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Equipment details</h2>
        <p className="text-gray-500 text-sm mt-1">Tell renters exactly what they're getting.</p>
      </div>

      {/* Category */}
      <div>
        <label className={label}>Category</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => set('category', c.value)}
              className={`py-2.5 px-3 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                data.category === c.value
                  ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                  : 'border-gray-200 text-gray-700 hover:border-blue-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Brand + Model */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Brand</label>
          <select value={data.brand} onChange={e => set('brand', e.target.value)} className={field}>
            <option value="">Select brand</option>
            {BRANDS.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Model</label>
          <input
            value={data.model}
            onChange={e => set('model', e.target.value)}
            placeholder="e.g. A7 IV, EOS R6, X100VI"
            className={field}
          />
        </div>
      </div>

      {/* Serial number */}
      <div>
        <label className={label}>Serial Number <span className="normal-case text-gray-400 font-normal">(for insurance purposes)</span></label>
        <input
          value={data.serialNumber}
          onChange={e => set('serialNumber', e.target.value)}
          placeholder="e.g. 1234567"
          className={field}
        />
      </div>

      {/* Condition */}
      <div>
        <label className={label}>Condition</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CONDITIONS.map(c => (
            <button
              key={c.value}
              onClick={() => set('condition', c.value)}
              className={`py-3 px-3 rounded-xl border-2 text-sm transition-all text-left ${
                data.condition === c.value
                  ? 'border-[#2563EB] bg-blue-50'
                  : 'border-gray-200 hover:border-blue-200'
              }`}
            >
              <p className={`font-semibold ${data.condition === c.value ? 'text-[#2563EB]' : 'text-[#111827]'}`}>{c.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{c.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className={label}>Description <span className="normal-case text-gray-400 font-normal">(min. 30 characters)</span></label>
        <textarea
          value={data.description}
          onChange={e => set('description', e.target.value)}
          rows={4}
          placeholder="Describe your equipment — features, any quirks, ideal use cases…"
          className={`${field} resize-none`}
        />
        <p className={`text-xs mt-1 ${data.description.length >= 30 ? 'text-[#22C55E]' : 'text-gray-400'}`}>
          {data.description.length}/30 minimum
        </p>
      </div>

      {/* Accessories */}
      <div>
        <label className={label}>Included Accessories</label>
        <div className="flex gap-2 mb-3">
          <input
            id="acc-input"
            placeholder="e.g. Battery, Charger, Strap…"
            className={`${field} flex-1`}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addAccessory((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = ''
              }
            }}
          />
          <button
            onClick={() => {
              const el = document.getElementById('acc-input') as HTMLInputElement
              addAccessory(el.value); el.value = ''
            }}
            className="w-10 h-10 bg-[#2563EB] text-white rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.accessories.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5 bg-blue-50 text-[#2563EB] text-xs font-semibold px-3 py-1.5 rounded-full">
              {a}
              <button onClick={() => removeAccessory(i)} className="hover:text-red-500 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 bg-[#2563EB] hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          Continue <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
