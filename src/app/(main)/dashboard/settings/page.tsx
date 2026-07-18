'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Save, Shield, Bell, Eye, EyeOff, HelpCircle, ChevronDown, ChevronRight, ExternalLink, MessageSquare, FileText, Loader2, Check, AlertCircle } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useProfile } from '@/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { VerificationCard } from '@/components/shared/VerificationCard'

export default function SettingsPage() {
  const live = isSupabaseConfigured()
  const { profile, email, loading, update, uploadAvatar } = useProfile()

  const [fullName, setFullName] = useState('')
  const [city, setCity] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSaved, setPwSaved] = useState(false)

  const [notifications, setNotifications] = useState({
    newBooking: true, messages: true, reminders: true, promos: false,
  })
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name)
      setCity(profile.city ?? '')
      setBio(profile.bio ?? '')
    }
  }, [profile])

  const FAQS = [
    { q: 'How do I become a host?', a: 'Click "Become a Host" in the navbar, complete the listing wizard, and submit your gear for review. Most listings go live within 24 hours.' },
    { q: 'What happens if equipment is damaged?', a: 'Rentivo offers Equipment Protection at checkout. Hosts are covered up to the declared value of their gear. Security deposits are held until the rental is completed.' },
    { q: 'How are payments processed?', a: 'We support GCash, Maya, and Credit/Debit Card. Payouts to hosts are processed within 3 business days after a completed rental.' },
    { q: 'Can I cancel a booking?', a: 'Cancellation policies vary per listing (Flexible, Moderate, or Strict). Check the listing\'s policy before booking. Hosts may also set their own cancellation terms.' },
    { q: 'How does identity verification work?', a: 'We require a government-issued ID and a selfie to verify your identity. This protects both hosts and renters on the platform.' },
  ]

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    setSaved(false)
    if (live) {
      const err = await update({ full_name: fullName, bio, city })
      if (err) setSaveError(err)
      else setSaved(true)
    } else {
      setSaved(true)
    }
    setSaving(false)
  }

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !live) return
    setUploadingAvatar(true)
    await uploadAvatar(file)
    setUploadingAvatar(false)
    e.target.value = ''
  }

  async function handlePasswordUpdate() {
    setPwError('')
    setPwSaved(false)
    if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/\d/.test(newPw)) {
      setPwError('New password must be at least 8 characters with upper, lower, and a digit.')
      return
    }
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match.')
      return
    }
    setPwSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwSaving(false)
    if (error) {
      setPwError(error.message)
      return
    }
    setPwSaved(true)
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
  }

  const initials = (fullName || email || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  if (live && loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-[#111827]">Account Settings</h1>

      {/* Profile */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h2 className="font-bold text-[#111827]">Profile</h2>

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="w-16 h-16">
              <AvatarImage src={profile?.avatar_url ?? ''} />
              <AvatarFallback className="bg-[#003049] text-white font-bold text-xl">{initials}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar || !live}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border-2 border-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 disabled:opacity-50"
            >
              {uploadingAvatar ? <Loader2 className="w-3.5 h-3.5 text-gray-600 animate-spin" /> : <Camera className="w-3.5 h-3.5 text-gray-600" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleAvatarPick} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827]">{fullName || 'Your name'}</p>
            <p className="text-xs text-gray-400">{email}</p>
            {live && (
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs text-[#003049] hover:underline mt-0.5 font-medium">
                Change photo
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Full Name</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">City</label>
            <input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="e.g. Manila"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, 200))}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{bio.length}/200</p>
        </div>

        {saveError && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {saveError}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-[#003049] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#002438] disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved' : 'Save Changes'}
        </button>
      </section>

      {live && <VerificationCard />}

      {/* Security */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#003049]" />
          <h2 className="font-bold text-[#111827]">Security</h2>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Current Password</label>
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-2.5 focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100">
            <input
              type={showCurrentPw ? 'text' : 'password'}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="••••••••"
              className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
            />
            <button type="button" onClick={() => setShowCurrentPw(v => !v)} className="text-gray-400">
              {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Confirm Password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {pwError && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {pwError}
          </div>
        )}

        <button
          onClick={handlePasswordUpdate}
          disabled={pwSaving || !live || !newPw || !confirmPw}
          className="flex items-center gap-2 bg-[#111827] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {pwSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : pwSaved ? <Check className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
          {pwSaved ? 'Updated' : 'Update Password'}
        </button>
      </section>

      {/* Notifications */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-[#003049]" />
          <h2 className="font-bold text-[#111827]">Notifications</h2>
        </div>

        <div className="space-y-3">
          {[
            { key: 'newBooking', label: 'New booking requests', desc: 'Get notified when someone requests your gear' },
            { key: 'messages', label: 'Messages', desc: 'Notifications for new chat messages' },
            { key: 'reminders', label: 'Rental reminders', desc: 'Pickup and return date reminders' },
            { key: 'promos', label: 'Promotions & tips', desc: 'Platform updates and hosting tips' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-medium text-[#111827]">{label}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
              <div
                onClick={() => setNotifications(n => ({ ...n, [key]: !n[key as keyof typeof n] }))}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${notifications[key as keyof typeof notifications] ? 'bg-[#003049]' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifications[key as keyof typeof notifications] ? 'translate-x-5' : ''}`} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400">These preferences are stored on this device for now.</p>
      </section>

      {/* Help Center */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-[#003049]" />
          <h2 className="font-bold text-[#111827]">Help Center</h2>
        </div>

        {/* FAQ accordion */}
        <div className="divide-y divide-gray-100">
          {FAQS.map(({ q, a }, i) => (
            <div key={i}>
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 py-3.5 text-left text-sm font-medium text-[#111827] hover:text-[#003049] transition-colors"
              >
                {q}
                {openFaq === i
                  ? <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />
                  : <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" />
                }
              </button>
              {openFaq === i && (
                <p className="pb-4 text-sm text-gray-500 leading-relaxed">{a}</p>
              )}
            </div>
          ))}
        </div>

        {/* Quick links */}
        <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
          <a
            href="mailto:support@rentivo.ph"
            className="flex items-center gap-2 text-sm font-medium text-[#003049] bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl transition-colors"
          >
            <MessageSquare className="w-4 h-4" /> Contact Support
          </a>
          <a
            href="#"
            className="flex items-center gap-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 px-4 py-2 rounded-xl transition-colors"
          >
            <FileText className="w-4 h-4" /> Terms of Service <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="#"
            className="flex items-center gap-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 px-4 py-2 rounded-xl transition-colors"
          >
            <FileText className="w-4 h-4" /> Privacy Policy <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </section>

      {/* Danger zone */}
      <section className="bg-red-50 border border-red-100 rounded-2xl p-6 space-y-3">
        <h2 className="font-bold text-red-700">Danger Zone</h2>
        <p className="text-sm text-red-600">
          Account deletion permanently removes your listings, bookings, and history and cannot be undone.
        </p>
        <a
          href="mailto:support@rentivo.ph?subject=Delete my Rentivo account"
          className="inline-block text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors"
        >
          Contact Support to Delete Account
        </a>
      </section>
    </div>
  )
}
