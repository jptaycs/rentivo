'use client'

import { useState } from 'react'
import { CheckCircle2, Star, CalendarDays, MessageSquare, DollarSign, AlertCircle, BadgeCheck } from 'lucide-react'

const MOCK_NOTIFICATIONS = [
  { id: 'n1', type: 'booking', icon: CalendarDays, color: 'text-[#2563EB] bg-blue-50', title: 'New booking request', body: 'Maria Santos wants to rent your Sony A7 IV from July 2–5.', at: '2 min ago', unread: true, action: 'View Booking' },
  { id: 'n2', type: 'message', icon: MessageSquare, color: 'text-purple-600 bg-purple-50', title: 'New message', body: 'John dela Cruz: "Is the lens available for July 6–7?"', at: '1 hr ago', unread: true, action: 'Reply' },
  { id: 'n3', type: 'review', icon: Star, color: 'text-yellow-500 bg-yellow-50', title: 'New review received', body: 'Trish Mendoza left you a 5-star review: "Great gear, super smooth transaction!"', at: '3 hrs ago', unread: true, action: 'View Review' },
  { id: 'n4', type: 'payout', icon: DollarSign, color: 'text-green-600 bg-green-50', title: 'Payout sent', body: '₱12,500 has been sent to your GCash account •••• 1234.', at: 'Yesterday', unread: false, action: null },
  { id: 'n5', type: 'verify', icon: BadgeCheck, color: 'text-[#2563EB] bg-blue-50', title: 'Listing approved', body: 'Your Sony A7 IV listing has been approved and is now live.', at: '2 days ago', unread: false, action: 'View Listing' },
  { id: 'n6', type: 'booking', icon: CheckCircle2, color: 'text-green-600 bg-green-50', title: 'Booking confirmed', body: 'Your booking for Canon RF 70-200mm (July 6–7) has been confirmed by the host.', at: '3 days ago', unread: false, action: null },
  { id: 'n7', type: 'alert', icon: AlertCircle, color: 'text-orange-500 bg-orange-50', title: 'Reminder: return due tomorrow', body: 'Your rental of iPhone 16 Pro Max is due for return tomorrow by 5:00 PM.', at: '3 days ago', unread: false, action: 'View Booking' },
]

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS)

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })))
  }

  const unreadCount = notifications.filter(n => n.unread).length

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-sm font-semibold text-[#2563EB] hover:text-blue-700 transition-colors">
            Mark all as read
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
        {notifications.map(n => {
          const Icon = n.icon
          return (
            <div
              key={n.id}
              onClick={() => setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, unread: false } : x))}
              className={`flex items-start gap-4 px-5 py-4 transition-colors cursor-pointer ${n.unread ? 'bg-blue-50/40 hover:bg-blue-50/60' : 'hover:bg-gray-50'}`}
            >
              {/* Icon */}
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${n.color}`}>
                <Icon className="w-5 h-5" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm ${n.unread ? 'font-bold text-[#111827]' : 'font-semibold text-gray-700'}`}>{n.title}</p>
                  <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">{n.at}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                {n.action && (
                  <button className="text-xs font-semibold text-[#2563EB] mt-2 hover:underline">{n.action} →</button>
                )}
              </div>

              {/* Unread dot */}
              {n.unread && (
                <div className="w-2 h-2 rounded-full bg-[#2563EB] shrink-0 mt-1.5" />
              )}
            </div>
          )
        })}
      </div>

      {notifications.every(n => !n.unread) && (
        <p className="text-center text-sm text-gray-400 py-4">You are all caught up!</p>
      )}
    </div>
  )
}
