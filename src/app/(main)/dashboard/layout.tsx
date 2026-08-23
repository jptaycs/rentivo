'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const isRenterSection = pathname.startsWith('/dashboard/rentals') ||
    pathname.startsWith('/dashboard/wishlist') ||
    pathname.startsWith('/dashboard/receipts')

  return (
    <div className="flex h-[calc(100vh-64px)] bg-[#F8FAFC]">
      {/* Desktop sidebar */}
      <div className="hidden md:flex w-60 shrink-0 flex-col">
        <DashboardSidebar isHost={!isRenterSection} />
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-64 h-full flex flex-col">
            <DashboardSidebar isHost={!isRenterSection} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

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
