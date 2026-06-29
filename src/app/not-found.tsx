import Link from 'next/link'
import Image from 'next/image'
import { Camera, Search, Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center px-4 text-center">
      {/* Logo */}
      <Link href="/" className="mb-12 inline-block">
        <Image src="/rentivo-logo.png" alt="Rentivo" width={160} height={52} className="h-12 w-auto object-contain" />
      </Link>

      {/* 404 */}
      <div className="relative mb-6">
        <p className="text-[120px] font-black text-gray-100 leading-none select-none">404</p>
        <div className="absolute inset-0 flex items-center justify-center">
          <Camera className="w-12 h-12 text-[#2563EB]" />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-[#111827] mb-2">Page not found</h1>
      <p className="text-gray-500 text-sm max-w-sm mb-8">
        The page you are looking for does not exist or has been moved. Let us help you find what you need.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/" className="flex items-center justify-center gap-2 bg-[#2563EB] text-white font-bold py-3 px-6 rounded-xl text-sm hover:bg-blue-700 transition-colors">
          <Home className="w-4 h-4" /> Back to Home
        </Link>
        <Link href="/search" className="flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-bold py-3 px-6 rounded-xl text-sm hover:bg-gray-50 transition-colors">
          <Search className="w-4 h-4" /> Browse Equipment
        </Link>
      </div>

      <p className="text-xs text-gray-400 mt-10">
        Need help?{' '}
        <a href="mailto:support@rentivo.ph" className="text-[#2563EB] hover:underline">Contact support</a>
      </p>
    </div>
  )
}
