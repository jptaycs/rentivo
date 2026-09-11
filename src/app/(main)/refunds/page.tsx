import Link from 'next/link'
import { LegalContact } from '@/components/shared/LegalContact'

export const metadata = { title: 'Return and Refund Policy — Rentivo' }

export default function RefundsPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Return and Refund Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 12, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">What this policy covers</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo is a rental marketplace. Nothing is sold or shipped to you, so there is no
            product return in the retail sense — a &quot;return&quot; here means handing the
            rented equipment back to the host at the end of the rental. This page covers both
            sides of that: when a booking can be cancelled and refunded, and how equipment is
            returned.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Cancelling a booking</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            A renter can cancel a booking only while it is still awaiting the host&apos;s
            response — before the host has accepted it. Once a host has accepted a booking, the
            renter can no longer cancel it themselves; write to us or to the host if something
            has changed.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            A host may also decline a booking that is still awaiting their response.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Refund amount</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If a cancelled or declined booking was already paid, it is refunded in full,
            including the service fee. There is no cancellation fee, and the refund does not
            shrink based on how close to the pickup date the cancellation happens.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">No cancellation tiers</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo does not offer named cancellation tiers, and the refund amount does not
            change from one listing to another. Every eligible cancellation is handled the same
            way, as described above.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">How refunds are paid</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            A refund is returned to the original payment method through PayMongo, our payment
            processor. It may take several banking days to appear, depending on your bank or
            e-wallet. We do not refund to a different account than the one you paid from.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">
            Bookings paid directly to a host&apos;s GCash or Maya QR
          </h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Some hosts accept payment through their own GCash or Maya QR code. That money goes
            straight to the host — Rentivo never receives it and therefore cannot refund it. If
            such a booking is cancelled, arrange the refund with the host directly. If the host
            will not return it, tell us through the{' '}
            <Link href="/disputes" className="text-[#003049] underline">
              Dispute Resolution Policy
            </Link>
            : we cannot move the money, but we can act on the account.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Returning the equipment</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              The renter returns the equipment to the host on the agreed return date, in the same
              condition it was received, with every accessory listed.
            </li>
            <li>
              A return made after the agreed date is charged at 1.5&times; the listing&apos;s
              daily rate for each late day, payable directly to the host.
            </li>
            <li>
              Where a listing shows a security deposit, the host collects it at pickup and
              returns it at handback. Rentivo does not charge, hold or return security deposits,
              and never has custody of that money.
            </li>
            <li>
              Loss or damage beyond normal wear and tear is the renter&apos;s responsibility and
              is settled between the host and the renter. Rentivo operates no insurance or
              damage-claims process. The full terms are in the{' '}
              <Link href="/rental-agreement" className="text-[#003049] underline">
                Rental Agreement
              </Link>
              .
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Asking for a refund</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Cancel from{' '}
            <Link href="/dashboard/rentals" className="text-[#003049] underline">
              My Rentals
            </Link>{' '}
            while the booking is still awaiting the host&apos;s response, and the refund starts
            automatically. If the booking has already been accepted, or something else has gone
            wrong, email us with your booking reference — see the{' '}
            <Link href="/contact" className="text-[#003049] underline">
              contact page
            </Link>
            . We aim to reply within 2 business days.
          </p>
        </section>

        <LegalContact purpose="cancellations, refunds, or returning equipment" />

        <section className="space-y-3">
          <p className="text-sm text-gray-700 leading-relaxed">
            This page describes how Rentivo actually works. It is not legal advice.
          </p>
        </section>
      </div>
    </div>
  )
}
