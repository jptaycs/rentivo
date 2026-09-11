import Link from 'next/link'
import { BUSINESS } from '@/lib/business'
import { LegalContact } from '@/components/shared/LegalContact'

export const metadata = { title: 'Rental Agreement — Rentivo' }

export default function RentalAgreementPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Rental Agreement</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 8, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">1. Who this agreement is between</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            This rental agreement is between the host and the renter for a specific booking made
            through Rentivo. Rentivo is operated by {BUSINESS.name}, which publishes this
            page as a reference for hosts and renters — Rentivo is not a party to this agreement,
            does not lend or own the equipment, and provides no insurance for the rental. Any
            question about this page itself can be sent to{' '}
            <a href={`mailto:${BUSINESS.email}`} className="text-[#003049] underline">
              {BUSINESS.email}
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">2. Pickup</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            The renter presents a valid government-issued ID to the host at handover. The host
            may decline to hand over the equipment if no valid ID is presented.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">3. Condition on return</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            The renter returns the equipment in the same condition it was received, together with
            every accessory included in the listing.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">4. Late return</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            A return made after the agreed return date is charged at 1.5&times; the listing&apos;s
            daily rate for each late day. This amount is payable directly to the host.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">5. No sub-renting</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            The renter may not sub-rent, lend, or otherwise transfer the equipment to any third
            party for any part of the rental period. Only the renter named on the booking may use
            the equipment.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">6. Security deposit</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Where the listing shows a security deposit, that amount is agreed and settled
            directly between the host and the renter — collected by the host at pickup and
            returned by the host at return, minus anything deducted under Section 7.{' '}
            <strong>Rentivo does not charge, hold, or return the security deposit.</strong> It is
            never part of the payment Rentivo processes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">7. Loss and damage</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            The renter is responsible for any loss of, or damage to, the equipment during the
            rental period beyond normal wear and tear. Loss and damage are settled directly
            between the host and the renter — Rentivo has no claims process and does not
            adjudicate disputes between them. Keep any discussion of condition, loss, or damage
            in the booking&apos;s{' '}
            <Link href="/dashboard/messages" className="text-[#003049] underline">
              message thread
            </Link>{' '}
            so there is a record both parties can refer back to. If you cannot settle it between
            you, see the{' '}
            <Link href="/disputes" className="text-[#003049] underline">
              Dispute Resolution Policy
            </Link>{' '}
            for what Rentivo can and cannot do.
          </p>
        </section>

        <LegalContact purpose="this agreement" />

        <section className="space-y-3">
          <p className="text-sm text-gray-700 leading-relaxed">
            This page describes how Rentivo actually works. It is not legal advice.
          </p>
        </section>
      </div>
    </div>
  )
}
