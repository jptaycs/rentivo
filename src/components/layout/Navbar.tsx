'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { Bell, MessageCircle, Menu, X, LayoutDashboard, Package, LogOut, Settings, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const navLinks = [
  { label: 'Cameras', href: '/search?category=mirrorless' },
  { label: 'Phones', href: '/search?category=smartphone' },
  { label: 'Lenses', href: '/search?category=lens' },
  { label: 'Creator Kits', href: '/search?category=bundle' },
]

const DROPDOWN_ITEMS = [
  { label: 'Dashboard', href: '/dashboard/overview', icon: LayoutDashboard },
  { label: 'My Listings', href: '/dashboard/listings', icon: Package },
  { label: 'Account Settings', href: '/dashboard/settings', icon: Settings },
]

export function Navbar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Close mobile menu on navigate
  useEffect(() => { setMobileOpen(false) }, [pathname])

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="shrink-0">
            <Image src="/rentivo-logo.png" alt="Rentivo" width={160} height={52} className="h-12 w-auto object-contain" priority />
          </Link>

          {/* Center nav — desktop */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const active = pathname.startsWith(link.href.split('?')[0]) && link.href.includes('?')
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    active ? 'text-[#003049] bg-blue-50' : 'text-gray-600 hover:text-[#003049] hover:bg-blue-50'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>

          {/* Right actions — desktop */}
          <div className="hidden md:flex items-center gap-1">
            <Link
              href="/host/new"
              className="text-sm font-semibold text-[#111827] px-4 py-2 rounded-full hover:bg-gray-100 transition-colors"
            >
              Become a Host
            </Link>

            <Link
              href="/dashboard/messages"
              className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
              title="Messages"
            >
              <MessageCircle className="w-5 h-5 text-gray-600" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#003049] rounded-full" />
            </Link>

            <Link
              href="/dashboard/notifications"
              className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
              title="Notifications"
            >
              <Bell className="w-5 h-5 text-gray-600" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#FDF0D5] rounded-full" />
            </Link>

            {/* Avatar dropdown */}
            <div ref={dropdownRef} className="relative">
              <button
                onClick={() => setDropdownOpen(v => !v)}
                className="flex items-center gap-1.5 ml-1"
              >
                <Avatar className="w-9 h-9 ring-2 ring-transparent hover:ring-[#003049] transition-all">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-[#003049] text-white text-xs font-semibold">JP</AvatarFallback>
                </Avatar>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden z-50">
                  {/* Profile snippet */}
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-bold text-[#111827]">Juan P. Tayco</p>
                    <p className="text-xs text-gray-400">jptayco1109@gmail.com</p>
                  </div>

                  {DROPDOWN_ITEMS.map(({ label, href, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Icon className="w-4 h-4 text-gray-400" />
                      {label}
                    </Link>
                  ))}

                  <div className="border-t border-gray-100">
                    <button
                      onClick={() => { setDropdownOpen(false); alert('Logged out') }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Log out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            onClick={() => setMobileOpen(v => !v)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:text-[#003049] hover:bg-blue-50 rounded-lg transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <div className="border-t border-gray-100 mt-2 pt-2 space-y-1">
              <Link href="/host/new" className="px-3 py-2.5 text-sm font-semibold text-[#111827] hover:bg-gray-50 rounded-lg block transition-colors">
                Become a Host
              </Link>
              <Link href="/dashboard/overview" className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-2 transition-colors">
                <LayoutDashboard className="w-4 h-4 text-gray-400" /> Dashboard
              </Link>
              <Link href="/dashboard/messages" className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-2 transition-colors">
                <MessageCircle className="w-4 h-4 text-gray-400" /> Messages
              </Link>
              <Link href="/dashboard/notifications" className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-2 transition-colors">
                <Bell className="w-4 h-4 text-gray-400" /> Notifications
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
