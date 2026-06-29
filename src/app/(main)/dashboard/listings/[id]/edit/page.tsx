'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import { ChevronLeft, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { MOCK_LISTINGS } from '@/lib/mock-data'

const CATEGORIES = ['Mirrorless Camera', 'DSLR Camera', 'Cinema Camera', 'Smartphone', 'Camera Lens', 'Creator Bundle']
const CONDITIONS = [
  { id: 'new', label: 'Like New', desc: 'Pristine condition, barely used' },
  { id: 'excellent', label: 'Excellent', desc: 'Light use, no visible wear' },
  { id: 'good', label: 'Good', desc: 'Normal wear, fully functional' },
  { id: 'fair', label: 'Fair', desc: 'Visible wear but works perfectly' },
]

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const listing = MOCK_LISTINGS.find(l => l.id === id) ?? MOCK_LISTINGS[0]

  const [title, setTitle] = useState(listing.title)
  const [description, setDescription] = useState(listing.description ?? 'Professional-grade equipment in excellent condition. All accessories included.')
  const [category, setCategory] = useState<string>(listing.category)
  const [condition, setCondition] = useState<string>('excellent')
  const [dailyPrice, setDailyPrice] = useState(String(listing.daily_price))
  const [weeklyPrice, setWeeklyPrice] = useState(String(Math.round(listing.daily_price * 6)))
  const [monthlyPrice, setMonthlyPrice] = useState(String(Math.round(listing.daily_price * 20)))
  const [deposit, setDeposit] = useState(String(listing.security_deposit))
  const [isInstantBook, setIsInstantBook] = useState(listing.is_instant_book ?? false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    await new Promise(r => setTimeout(r, 1200))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const field = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 transition-all bg-white'
  const label = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5'

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/listings" className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors">
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </Link>
            <div>
              <p className="font-bold text-[#111827] text-sm">Edit Listing</p>
              <p className="text-xs text-gray-400 truncate max-w-[200px]">{listing.title}</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="flex items-center gap-2 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-colors"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : saved ? <><CheckCircle2 className="w-4 h-4" /> Saved!</>
              : <><Save className="w-4 h-4" /> Save Changes</>}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Details */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <p className="font-bold text-[#111827]">Equipment Details</p>

          <div>
            <label className={label}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={field} />
          </div>

          <div>
            <label className={label}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className={label}>Condition</label>
            <div className="grid grid-cols-2 gap-2">
              {CONDITIONS.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCondition(c.id)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${condition === c.id ? 'border-[#003049] bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <p className={`text-sm font-bold ${condition === c.id ? 'text-[#003049]' : 'text-[#111827]'}`}>{c.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{c.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className={`${field} resize-none`}
            />
            <p className="text-xs text-gray-400 mt-1">{description.length} characters</p>
          </div>
        </section>

        {/* Pricing */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <p className="font-bold text-[#111827]">Pricing</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Daily Rate</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">₱</span>
                <input
                  type="number" value={dailyPrice} onChange={e => setDailyPrice(e.target.value)}
                  className={`${field} pl-8`}
                />
              </div>
            </div>
            <div>
              <label className={label}>Security Deposit</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">₱</span>
                <input
                  type="number" value={deposit} onChange={e => setDeposit(e.target.value)}
                  className={`${field} pl-8`}
                />
              </div>
            </div>
            <div>
              <label className={label}>Weekly Rate <span className="font-normal text-gray-400 normal-case">(optional)</span></label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">₱</span>
                <input
                  type="number" value={weeklyPrice} onChange={e => setWeeklyPrice(e.target.value)}
                  className={`${field} pl-8`}
                />
              </div>
            </div>
            <div>
              <label className={label}>Monthly Rate <span className="font-normal text-gray-400 normal-case">(optional)</span></label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">₱</span>
                <input
                  type="number" value={monthlyPrice} onChange={e => setMonthlyPrice(e.target.value)}
                  className={`${field} pl-8`}
                />
              </div>
            </div>
          </div>

          {dailyPrice && (
            <div className="bg-[#F8FAFC] rounded-xl p-4 text-sm text-gray-600 border border-gray-100">
              You earn <strong className="text-[#22C55E]">₱{Math.round(Number(dailyPrice) * 0.88).toLocaleString()}</strong> per day after the 12% Rentivo service fee.
            </div>
          )}
        </section>

        {/* Instant Book */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-bold text-[#111827]">Instant Book</p>
              <p className="text-sm text-gray-500 mt-0.5">Let renters book without waiting for approval. Gets 2× more bookings.</p>
            </div>
            <div
              onClick={() => setIsInstantBook(v => !v)}
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer shrink-0 mt-1 ${isInstantBook ? 'bg-[#F97316]' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isInstantBook ? 'translate-x-6' : ''}`} />
            </div>
          </div>
        </section>

        {/* Danger zone */}
        <section className="bg-white rounded-2xl border border-red-100 p-5">
          <p className="font-bold text-red-600 mb-3 text-sm">Danger Zone</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#111827]">Pause this listing</p>
              <p className="text-xs text-gray-400 mt-0.5">Hides it from search while keeping booking history</p>
            </div>
            <button className="text-sm font-bold text-orange-600 border border-orange-200 px-4 py-2 rounded-xl hover:bg-orange-50 transition-colors">
              Pause Listing
            </button>
          </div>
          <div className="border-t border-gray-100 mt-4 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#111827]">Delete listing</p>
              <p className="text-xs text-gray-400 mt-0.5">Permanently removes this listing and all its data</p>
            </div>
            <button className="text-sm font-bold text-red-600 border border-red-200 px-4 py-2 rounded-xl hover:bg-red-50 transition-colors">
              Delete
            </button>
          </div>
        </section>

      </div>
    </div>
  )
}
