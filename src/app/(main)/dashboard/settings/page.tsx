'use client'

import { useState } from 'react'
import { Camera, Save, Shield, Bell, Eye, EyeOff } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'

export default function SettingsPage() {
  const [fullName, setFullName] = useState('Juan P. Taylor')
  const [email] = useState('jptayco1109@gmail.com')
  const [phone, setPhone] = useState('+63 917 000 4321')
  const [bio, setBio] = useState('Professional photographer based in Manila. Renting out my gear to fellow creators.')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [notifications, setNotifications] = useState({
    newBooking: true, messages: true, reminders: true, promos: false,
  })

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
              <AvatarFallback className="bg-[#003049] text-white font-bold text-xl">JP</AvatarFallback>
            </Avatar>
            <button className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border-2 border-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-50">
              <Camera className="w-3.5 h-3.5 text-gray-600" />
            </button>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827]">{fullName}</p>
            <p className="text-xs text-gray-400">{email}</p>
            <button className="text-xs text-[#003049] hover:underline mt-0.5 font-medium">Change photo</button>
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
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Phone</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{bio.length}/200</p>
        </div>

        <button className="flex items-center gap-2 bg-[#003049] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#002438] transition-colors">
          <Save className="w-4 h-4" /> Save Changes
        </button>
      </section>

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
              placeholder="••••••••"
              className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
            />
            <button type="button" onClick={() => setShowCurrentPw(v => !v)} className="text-gray-400">
              {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {['New Password', 'Confirm Password'].map(label => (
            <div key={label}>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100"
              />
            </div>
          ))}
        </div>

        <button className="flex items-center gap-2 bg-[#111827] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors">
          <Shield className="w-4 h-4" /> Update Password
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
      </section>

      {/* Danger zone */}
      <section className="bg-red-50 border border-red-100 rounded-2xl p-6 space-y-3">
        <h2 className="font-bold text-red-700">Danger Zone</h2>
        <p className="text-sm text-red-600">Permanently delete your account and all listings. This cannot be undone.</p>
        <button className="text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors">
          Delete Account
        </button>
      </section>
    </div>
  )
}
