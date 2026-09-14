'use client'

import { Printer } from 'lucide-react'

/**
 * Print the statement. A one-line client component because the admin statement
 * page is a Server Component (it reads through the service-role client) and
 * window.print() needs the browser.
 */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-xl bg-[#003049] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#002438]"
    >
      <Printer className="h-4 w-4" /> Print
    </button>
  )
}
