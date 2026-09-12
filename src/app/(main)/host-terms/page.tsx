import { LegalContact } from '@/components/shared/LegalContact'

export const metadata = { title: 'Host Terms — Rentivo' }

export default function HostTermsPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Host Terms of Service</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 8, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Hosting on Rentivo</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>Your identity must be verified by Rentivo before your listings are published.</li>
            <li>Listings must describe equipment you own, accurately, with current photos and a truthful condition.</li>
            <li>Security deposits you set are collected from the renter by you at pickup and returned by you — Rentivo does not charge, hold or return them.</li>
            <li>Rentivo charges a 5% service fee on the rental fee of every booking, deducted from the payment when it is processed. Delivery fees you set are paid to you in full.</li>
          </ul>
        </section>

        <LegalContact purpose="these host terms or a payout" />
      </div>
    </div>
  )
}
