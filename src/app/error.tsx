'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { RefreshCw, Home, AlertTriangle } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center px-4 text-center font-sans">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>

        <h1 className="text-2xl font-bold text-[#111827] mb-2">Something went wrong</h1>
        <p className="text-gray-500 text-sm max-w-sm mb-8">
          An unexpected error occurred. Our team has been notified and we are working on a fix.
        </p>

        {error.digest && (
          <p className="text-xs text-gray-300 font-mono mb-6">Error ID: {error.digest}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 bg-[#003049] text-white font-bold py-3 px-6 rounded-xl text-sm hover:bg-[#002438] transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
          <Link href="/"
            className="flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-bold py-3 px-6 rounded-xl text-sm hover:bg-gray-50 transition-colors"
          >
            <Home className="w-4 h-4" /> Back to Home
          </Link>
        </div>
      </body>
    </html>
  )
}
