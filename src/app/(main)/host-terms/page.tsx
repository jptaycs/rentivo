import Link from 'next/link'
import { POLICY_START_LABEL, GRACE_DAYS } from '@/lib/billing'

export const metadata = { title: 'Host Terms — Rentivo' }

export default function HostTermsPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Host Terms of Service</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated {POLICY_START_LABEL}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Hosting on Rentivo</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>Your identity must be verified by Rentivo before your listings are published.</li>
            <li>Listings must describe equipment you own, accurately, with current photos and a truthful condition.</li>
            <li>Security deposits you set are held for the rental and returned when the equipment comes back as agreed.</li>
            <li>Rentivo charges a 5% service fee on the rental fee of every booking. Delivery fees you set are paid to you in full.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Commission on direct QR payments</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            When a renter pays you through your own GCash or Maya QR code, the full amount — including Rentivo&apos;s 5% service fee — goes straight to your account. That fee is collected from you afterwards:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>On the 1st of each month, Rentivo issues you a bill for the 5% service fee on every direct-QR booking you confirmed as paid in the previous month. Months with no such bookings are not billed.</li>
            <li>Bills are due {GRACE_DAYS} days after they are issued and are paid in-app via QR Ph from your <Link href="/dashboard/bills" className="text-[#003049] underline">Bills page</Link>. You&apos;ll get an email and an in-app notification when one is issued.</li>
            <li>If a bill is still unpaid after its due date, renters can no longer pay you by direct QR until it is settled. Your listings stay live and bookable through Rentivo&apos;s other payment methods.</li>
            <li>This applies to bookings confirmed as paid on or after {POLICY_START_LABEL}.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
