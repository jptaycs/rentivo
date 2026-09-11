import { Logo } from '@/components/layout/Logo'
import { ListingWizard } from '@/components/host/ListingWizard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'List Your Equipment — Rentivo',
}

export default function NewListingPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Wizard header */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
            Your progress is saved automatically
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <ListingWizard />
      </div>
    </div>
  )
}
