'use client'

import { ChevronLeft, ChevronRight, MapPin, Zap } from 'lucide-react'

interface AddressData {
  streetAddress: string
  city: string
  province: string
  isInstantBook: boolean
}

interface Step5AddressProps {
  data: AddressData
  onChange: (d: AddressData) => void
  onNext: () => void
  onBack: () => void
}

const PROVINCES = [
  'Metro Manila', 'Cebu', 'Davao', 'Bulacan', 'Laguna', 'Cavite',
  'Pampanga', 'Batangas', 'Rizal', 'Quezon', 'Iloilo', 'Negros Occidental', 'Other'
]

const PH_CITIES: Record<string, string[]> = {
  'Metro Manila': ['Makati', 'BGC (Taguig)', 'Quezon City', 'Pasig', 'Mandaluyong', 'Marikina', 'Paranaque', 'Manila', 'Pasay', 'Las Piñas', 'Muntinlupa'],
  'Cebu': ['Cebu City', 'Mandaue', 'Lapu-Lapu', 'Talisay'],
  'Davao': ['Davao City', 'Tagum', 'Digos'],
}

export function Step5Address({ data, onChange, onNext, onBack }: Step5AddressProps) {
  function set<K extends keyof AddressData>(key: K, value: AddressData[K]) {
    onChange({ ...data, [key]: value })
  }

  const cities = PH_CITIES[data.province] ?? []
  const canContinue = data.city && data.province

  const field = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 transition-all bg-white'
  const label = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Pickup location</h2>
        <p className="text-gray-500 text-sm mt-1">Renters will see city and province only. The exact address is shared after booking.</p>
      </div>

      {/* Province */}
      <div>
        <label className={label}>Province / Region <span className="text-red-400">*</span></label>
        <select
          value={data.province}
          onChange={e => { set('province', e.target.value); set('city', '') }}
          className={field}
        >
          <option value="">Select province</option>
          {PROVINCES.map(p => <option key={p}>{p}</option>)}
        </select>
      </div>

      {/* City */}
      <div>
        <label className={label}>City / Municipality <span className="text-red-400">*</span></label>
        {cities.length > 0 ? (
          <select value={data.city} onChange={e => set('city', e.target.value)} className={field}>
            <option value="">Select city</option>
            {cities.map(c => <option key={c}>{c}</option>)}
          </select>
        ) : (
          <input
            value={data.city}
            onChange={e => set('city', e.target.value)}
            placeholder="Enter your city"
            className={field}
          />
        )}
      </div>

      {/* Street address */}
      <div>
        <label className={label}>Street Address <span className="font-normal text-gray-400 normal-case">(shared only after booking)</span></label>
        <input
          value={data.streetAddress}
          onChange={e => set('streetAddress', e.target.value)}
          placeholder="Unit/Floor, Street Name, Barangay"
          className={field}
        />
      </div>

      {/* Privacy notice */}
      <div className="flex items-start gap-2 text-xs text-gray-400 bg-[#F8FAFC] rounded-xl p-4">
        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#003049]" />
        Renters see <strong className="text-gray-500">city and province</strong> on the listing. Your full street address is only shown after a booking is confirmed.
      </div>

      {/* Instant Book toggle */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-[#FDF0D5]" />
            </div>
            <div>
              <p className="font-bold text-[#111827]">Instant Book</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Renters can book immediately without waiting for your approval. Listings with Instant Book get <strong>2× more bookings</strong>.
              </p>
            </div>
          </div>
          <div
            onClick={() => set('isInstantBook', !data.isInstantBook)}
            className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer shrink-0 mt-1 ${data.isInstantBook ? 'bg-[#FDF0D5]' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${data.isInstantBook ? 'translate-x-6' : ''}`} />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-2 px-5 py-3.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          Continue <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
