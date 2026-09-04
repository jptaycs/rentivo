'use client'

import { Suspense, useState } from 'react'
import { Menu } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { usePathname, useSearchParams } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'

interface SidebarsProps {
  sidebarOpen: boolean
  onCloseMobile: () => void
}

// Isolated in its own component so useSearchParams() (which opts a page out
// of static rendering unless wrapped in Suspense) doesn't force that on the
// whole dashboard layout — only this part needs it.
function DashboardSidebars({ sidebarOpen, onCloseMobile }: SidebarsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Messages/Reviews/Notifications/Settings are shared between host and
  // renter dashboards — the path alone can't tell which sidebar to show,
  // so every link into them (sidebar nav, "Message Host"/"Message"
  // buttons, "View all reviews") carries an explicit ?view= param. Falls
  // back to the path-prefix check for the renter-only routes below when
  // no param is present (e.g. a bookmark), and defaults to host otherwise
  // — matching this app's original behavior for any link this doesn't
  // yet cover.
  const view = searchParams.get('view')
  // With no ?view= param this used to fall back to the renter-only path list
  // and default to HOST for everything else — so a renter who bookmarked or
  // deep-linked /dashboard/messages, /reviews or /settings got a host sidebar
  // offering My Listings, Earnings and Payout Settings, none of which apply to
  // them. Fall back to the account's own is_host flag instead. `profile` is
  // null while loading, so the host default is preserved until it resolves,
  // which keeps a host from flashing the renter nav on first paint.
  const { profile } = useProfile()
  const accountIsRenterOnly = profile ? !profile.is_host : false
  const isRenterSection =
    view === 'renter' ||
    (view !== 'host' &&
      (pathname.startsWith('/dashboard/rentals') ||
        pathname.startsWith('/dashboard/wishlist') ||
        pathname.startsWith('/dashboard/receipts') ||
        pathname.startsWith('/dashboard/notifications') ||
        accountIsRenterOnly))

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex w-60 shrink-0 flex-col">
        <DashboardSidebar isHost={!isRenterSection} />
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/40" onClick={onCloseMobile} />
          <div className="relative w-64 h-full flex flex-col">
            <DashboardSidebar isHost={!isRenterSection} onClose={onCloseMobile} />
          </div>
        </div>
      )}
    </>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-[calc(100vh-64px)] bg-[#F8FAFC]">
      <Suspense fallback={<div className="hidden md:flex w-60 shrink-0 border-r border-gray-100 bg-white" />}>
        <DashboardSidebars sidebarOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} />
      </Suspense>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5">
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <span className="font-semibold text-[#111827] text-sm">Dashboard</span>
        </div>

        {/* Scrollable page content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
