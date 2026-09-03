'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Package, CalendarDays, MessageCircle,
  DollarSign, Star, BarChart2, CreditCard, Settings,
  ShoppingBag, Heart, Receipt, Bell, LogOut,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useUser, initials } from '@/hooks/useUser'
import { useThreads } from '@/hooks/useThreads'

const HOST_NAV = [
  { label: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard },
  { label: 'My Listings', href: '/dashboard/listings', icon: Package },
  { label: 'Bookings', href: '/dashboard/bookings', icon: CalendarDays },
  { label: 'Calendar', href: '/dashboard/calendar', icon: CalendarDays },
  { label: 'Messages', href: '/dashboard/messages?view=host', icon: MessageCircle, unread: true },
  { label: 'Earnings', href: '/dashboard/earnings', icon: DollarSign },
  { label: 'Bills', href: '/dashboard/bills', icon: Receipt },
  { label: 'Reviews', href: '/dashboard/reviews?view=host', icon: Star },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart2 },
  { label: 'Payout Settings', href: '/dashboard/payouts', icon: CreditCard },
  { label: 'Settings', href: '/dashboard/settings?view=host', icon: Settings },
]

const RENTER_NAV = [
  { label: 'My Rentals', href: '/dashboard/rentals', icon: ShoppingBag },
  { label: 'Messages', href: '/dashboard/messages?view=renter', icon: MessageCircle, unread: true },
  { label: 'Wishlist', href: '/dashboard/wishlist', icon: Heart },
  { label: 'Receipts', href: '/dashboard/receipts', icon: Receipt },
  { label: 'Reviews', href: '/dashboard/reviews?view=renter', icon: Star },
  { label: 'Notifications', href: '/dashboard/notifications', icon: Bell },
  { label: 'Settings', href: '/dashboard/settings?view=renter', icon: Settings },
]

interface DashboardSidebarProps {
  isHost?: boolean
  onClose?: () => void
}

export function DashboardSidebar({ isHost = true, onClose }: DashboardSidebarProps) {
  const pathname = usePathname()
  const nav = isHost ? HOST_NAV : RENTER_NAV
  const { user, signOut } = useUser()
  const { totalUnread } = useThreads()

  return (
    <aside className="flex flex-col h-full bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <Link href="/" onClick={onClose}>
          <Image src="/rentivo-logo.png" alt="Rentivo" width={130} height={44} className="h-10 w-auto object-contain" />
        </Link>
      </div>

      {/* Mode toggle */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex bg-gray-100 rounded-xl p-1 text-xs font-semibold">
          <Link
            href="/dashboard/overview"
            onClick={onClose}
            className={`flex-1 text-center py-1.5 rounded-lg transition-all ${
              isHost ? 'bg-white text-[#003049] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Host
          </Link>
          <Link
            href="/dashboard/rentals"
            onClick={onClose}
            className={`flex-1 text-center py-1.5 rounded-lg transition-all ${
              !isHost ? 'bg-white text-[#003049] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Renter
          </Link>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {nav.map(({ label, href, icon: Icon, unread }) => {
          const hrefPath = href.split('?')[0]
          const active = pathname === hrefPath || pathname.startsWith(hrefPath + '/')
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-blue-50 text-[#003049]'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-[#111827]'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#003049]' : 'text-gray-400'}`} />
              <span className="flex-1">{label}</span>
              {/* Real unread count. This was a hardcoded `badge: 3` (host) /
                  `badge: 1` (renter) — every user saw the same invented number,
                  contradicting the "0 unread" the messages panel itself showed.
                  It was also bg-[#FDF0D5] with text-white: white on the cream
                  accent, i.e. unreadable — the accent-on-light contrast bug this
                  repo has hit repeatedly. Now the actual count, in primary blue. */}
              {unread && totalUnread > 0 ? (
                <span className="min-w-[18px] h-[18px] bg-[#003049] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

      {/* Profile footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarImage src={user?.avatarUrl ?? ''} />
            <AvatarFallback className="bg-[#003049] text-white text-xs font-bold">
              {initials(user?.name ?? 'U')}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#111827] truncate">{user?.name ?? 'Loading…'}</p>
            <p className="text-[11px] text-gray-400 truncate">{user?.email ?? ''}</p>
          </div>
          <button onClick={signOut} className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
