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

const HOST_NAV = [
  { label: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard },
  { label: 'My Listings', href: '/dashboard/listings', icon: Package },
  { label: 'Bookings', href: '/dashboard/bookings', icon: CalendarDays },
  { label: 'Calendar', href: '/dashboard/calendar', icon: CalendarDays },
  { label: 'Messages', href: '/dashboard/messages', icon: MessageCircle, badge: 3 },
  { label: 'Earnings', href: '/dashboard/earnings', icon: DollarSign },
  { label: 'Reviews', href: '/dashboard/reviews', icon: Star },
  { label: 'Analytics', href: '/dashboard/analytics', icon: BarChart2 },
  { label: 'Payout Settings', href: '/dashboard/payouts', icon: CreditCard },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

const RENTER_NAV = [
  { label: 'My Rentals', href: '/dashboard/rentals', icon: ShoppingBag },
  { label: 'Messages', href: '/dashboard/messages', icon: MessageCircle, badge: 1 },
  { label: 'Wishlist', href: '/dashboard/wishlist', icon: Heart },
  { label: 'Receipts', href: '/dashboard/receipts', icon: Receipt },
  { label: 'Reviews', href: '/dashboard/reviews', icon: Star },
  { label: 'Notifications', href: '/dashboard/notifications', icon: Bell },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
]

interface DashboardSidebarProps {
  isHost?: boolean
  onClose?: () => void
}

export function DashboardSidebar({ isHost = true, onClose }: DashboardSidebarProps) {
  const pathname = usePathname()
  const nav = isHost ? HOST_NAV : RENTER_NAV

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
              isHost ? 'bg-white text-[#2563EB] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Host
          </Link>
          <Link
            href="/dashboard/rentals"
            onClick={onClose}
            className={`flex-1 text-center py-1.5 rounded-lg transition-all ${
              !isHost ? 'bg-white text-[#2563EB] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Renter
          </Link>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {nav.map(({ label, href, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-blue-50 text-[#2563EB]'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-[#111827]'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#2563EB]' : 'text-gray-400'}`} />
              <span className="flex-1">{label}</span>
              {badge ? (
                <span className="min-w-[18px] h-[18px] bg-[#F97316] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {badge}
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
            <AvatarImage src="" />
            <AvatarFallback className="bg-[#2563EB] text-white text-xs font-bold">JP</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#111827] truncate">Juan P. Taylor</p>
            <p className="text-[11px] text-gray-400 truncate">jptayco1109@gmail.com</p>
          </div>
          <button className="text-gray-400 hover:text-red-500 transition-colors shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
