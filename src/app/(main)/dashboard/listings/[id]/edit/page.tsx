'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SERVICE_FEE_RATE } from '@/lib/pricing'
import { LISTING_COLUMNS } from '@/lib/listing-columns'

// Values must match the listings table's equipment_category / listing_condition
// enums (001_initial_schema.sql) — same options the host wizard's Step2Details uses.
const CATEGORIES = [
  { value: 'mirrorless', label: 'Mirrorless Camera' },
  { value: 'dslr', label: 'DSLR Camera' },
  { value: 'digital', label: 'Digital Camera' },
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

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [condition, setCondition] = useState('')
  const [dailyPrice, setDailyPrice] = useState('')
  const [weeklyPrice, setWeeklyPrice] = useState('')
  const [monthlyPrice, setMonthlyPrice] = useState('')
  const [deposit, setDeposit] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('')
  const [isInstantBook, setIsInstantBook] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setNotFound(true)
      setLoading(false)
      return
    }
    // Scoped to host_id as well as id: RLS governs this too, but an explicit
    // filter makes "someone else's listing" a clean not-found rather than an
    // empty-looking form.
    const { data, error: loadError } = await supabase
      .from('listings')
      // Explicit columns, not '*': migration 064 revoked table-level SELECT on
      // listings, so a bare select('*') now 403s on street_address /
      // serial_number / latitude / longitude. This page never used them.
      .select(LISTING_COLUMNS)
      .eq('id', id)
      .eq('host_id', user.id)
      .maybeSingle()
    if (loadError || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setTitle(data.title ?? '')
    setDescription(data.description ?? '')
    setCategory(data.category ?? '')
    setCondition(data.condition ?? '')
    setDailyPrice(String(data.daily_price ?? ''))
    setWeeklyPrice(data.weekly_price != null ? String(data.weekly_price) : '')
    setMonthlyPrice(data.monthly_price != null ? String(data.monthly_price) : '')
    setDeposit(String(data.security_deposit ?? ''))
    setDeliveryFee(data.delivery_fee != null ? String(data.delivery_fee) : '')
    setIsInstantBook(data.is_instant_book ?? false)
    setIsActive(data.is_active ?? true)
    setLoading(false)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern used across this codebase's data hooks (see AGENTS.md)
    load()
  }, [load])

  async function handleSave() {
    setError('')
    if (!title.trim()) return setError('Title is required.')
    if (Number(dailyPrice) < 100) return setError('Daily rate must be at least ₱100.')
    if (Number(deposit) < 0) return setError('Security deposit cannot be negative.')

    setSaving(true)
    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('listings')
      .update({
        title: title.trim(),
        description: description.trim(),
        category,
        condition,
        daily_price: Number(dailyPrice),
        weekly_price: weeklyPrice ? Number(weeklyPrice) : null,
        monthly_price: monthlyPrice ? Number(monthlyPrice) : null,
        security_deposit: Number(deposit || 0),
        delivery_fee: deliveryFee === '' ? null : Number(deliveryFee),
        is_instant_book: isInstantBook,
      })
      .eq('id', id)
    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function togglePaused() {
    setError('')
    setBusy(true)
    const supabase = createClient()
    const { error: pauseError } = await supabase
      .from('listings')
      .update({ is_active: !isActive })
      .eq('id', id)
    setBusy(false)
    if (pauseError) {
      setError(pauseError.message)
      return
    }
    setIsActive(v => !v)
  }

  async function handleDelete() {
    if (!confirm('Permanently delete this listing? This cannot be undone.')) return
    setError('')
    setBusy(true)
    const supabase = createClient()
    const { error: deleteError } = await supabase.from('listings').delete().eq('id', id)
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    router.push('/dashboard/listings')
  }

  const field = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 transition-all bg-white'
  const label = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5'

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center max-w-sm">
          <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="font-bold text-[#111827]">Listing not found</p>
          <p className="text-sm text-gray-500 mt-1">
            It may have been deleted, or it isn&apos;t one of your listings.
          </p>
          <Link
            href="/dashboard/listings"
            className="inline-block mt-5 bg-[#003049] text-white font-bold text-sm px-5 py-2.5 rounded-xl"
          >
            Back to My Listings
          </Link>
        </div>
      </div>
    )
  }

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
              <p className="text-xs text-gray-400 truncate max-w-[200px]">{title}</p>
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

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {!isActive && (
          <div className="bg-orange-50 border border-orange-100 text-orange-800 rounded-xl px-4 py-3 text-sm">
            This listing is paused — it&apos;s hidden from search until you activate it again.
          </div>
        )}

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
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label className={label}>Condition</label>
            <div className="grid grid-cols-2 gap-2">
              {CONDITIONS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setCondition(c.value)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${condition === c.value ? 'border-[#003049] bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <p className={`text-sm font-bold ${condition === c.value ? 'text-[#003049]' : 'text-[#111827]'}`}>{c.label}</p>
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
              You earn <strong className="text-[#22C55E]">₱{Math.round(Number(dailyPrice) * (1 - SERVICE_FEE_RATE)).toLocaleString()}</strong> per day after the {Math.round(SERVICE_FEE_RATE * 100)}% Rentivo service fee.
            </div>
          )}

          <div>
            <label className={label}>Delivery Fee <span className="font-normal text-gray-400 normal-case">(optional)</span></label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">₱</span>
              <input
                type="number" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)}
                placeholder="Leave blank if you don't deliver"
                className={`${field} pl-8`}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Leave this blank if you only do pickup — renters won&apos;t see a delivery option.
              Enter 0 to offer free delivery. This is added to the renter&apos;s total and paid to you in full.
            </p>
          </div>
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
              className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer shrink-0 mt-1 ${isInstantBook ? 'bg-[#003049]' : 'bg-gray-200'}`}
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
              <p className="text-sm font-medium text-[#111827]">{isActive ? 'Pause this listing' : 'Activate this listing'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {isActive
                  ? 'Hides it from search while keeping booking history'
                  : 'Makes it visible in search again'}
              </p>
            </div>
            <button
              onClick={togglePaused}
              disabled={busy}
              className="text-sm font-bold text-orange-600 border border-orange-200 px-4 py-2 rounded-xl hover:bg-orange-50 transition-colors disabled:opacity-50"
            >
              {isActive ? 'Pause Listing' : 'Activate Listing'}
            </button>
          </div>
          <div className="border-t border-gray-100 mt-4 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#111827]">Delete listing</p>
              <p className="text-xs text-gray-400 mt-0.5">Permanently removes this listing and all its data</p>
            </div>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-sm font-bold text-red-600 border border-red-200 px-4 py-2 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </section>

      </div>
    </div>
  )
}
