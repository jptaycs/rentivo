'use client'

import Link from 'next/link'
import { CheckCircle2, Star, CalendarDays, DollarSign, XCircle, Loader2, Bell, ShieldCheck, ShieldX, Receipt } from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Notification } from '@/types'

const MOCK_NOTIFICATIONS = [
  { id: 'n1', type: 'booking_request', title: 'New booking request', body: 'Maria Santos wants to rent your Sony A7 IV from July 2–5.', at: '2 min ago', unread: true, link: '/dashboard/bookings' },
  { id: 'n3', type: 'review_received', title: 'New review received', body: 'Trish Mendoza left you a 5-star review: "Great gear, super smooth transaction!"', at: '3 hrs ago', unread: true, link: '/dashboard/reviews' },
  { id: 'n4', type: 'booking_paid', title: 'Payment received', body: '₱12,500 payment received for booking RNT-A1B2C3.', at: 'Yesterday', unread: false, link: '/dashboard/earnings' },
  { id: 'n6', type: 'booking_confirmed', title: 'Booking confirmed', body: 'Your booking for Canon RF 70-200mm (July 6–7) has been confirmed by the host.', at: '3 days ago', unread: false, link: '/dashboard/rentals' },
]

const ICONS: Record<string, { icon: typeof Bell; color: string }> = {
  booking_request: { icon: CalendarDays, color: 'text-[#003049] bg-blue-50' },
  booking_confirmed: { icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
  booking_cancelled: { icon: XCircle, color: 'text-red-500 bg-red-50' },
  booking_completed: { icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
  booking_paid: { icon: DollarSign, color: 'text-green-600 bg-green-50' },
  review_received: { icon: Star, color: 'text-yellow-500 bg-yellow-50' },
  verification_approved: { icon: ShieldCheck, color: 'text-green-600 bg-green-50' },
  verification_rejected: { icon: ShieldX, color: 'text-red-500 bg-red-50' },
  bill_issued: { icon: Receipt, color: 'text-[#003049] bg-blue-50' },
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

export default function NotificationsPage() {
  const live = isSupabaseConfigured()
  const { notifications: liveNotifications, loading, unreadCount: liveUnread, markRead, markAllRead } = useNotifications()

  const items = live
    ? liveNotifications.map((n: Notification) => ({ ...n, at: timeAgo(n.created_at), unread: !n.is_read }))
    : MOCK_NOTIFICATIONS

  const unreadCount = live ? liveUnread : items.filter((n) => n.unread).length

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && live && (
          <button onClick={markAllRead} className="text-sm font-semibold text-[#003049] hover:text-blue-700 transition-colors">
            Mark all as read
          </button>
        )}
      </div>

      {live && loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No notifications yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
          {items.map((n) => {
            const { icon: Icon, color } = ICONS[n.type] ?? { icon: Bell, color: 'text-gray-500 bg-gray-50' }
            const content = (
              <div
                className={`flex items-start gap-4 px-5 py-4 transition-colors cursor-pointer ${n.unread ? 'bg-blue-50/40 hover:bg-blue-50/60' : 'hover:bg-gray-50'}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${n.unread ? 'font-bold text-[#111827]' : 'font-semibold text-gray-700'}`}>{n.title}</p>
                    <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">{n.at}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                </div>
                {n.unread && <div className="w-2 h-2 rounded-full bg-[#003049] shrink-0 mt-1.5" />}
              </div>
            )
            return live ? (
              <Link key={n.id} href={n.link ?? '#'} onClick={() => n.unread && markRead(n.id)}>
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            )
          })}
        </div>
      )}

      {items.length > 0 && unreadCount === 0 && (
        <p className="text-center text-sm text-gray-400 py-4">You are all caught up!</p>
      )}
    </div>
  )
}
