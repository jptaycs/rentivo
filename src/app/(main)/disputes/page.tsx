import Link from 'next/link'
import { BUSINESS } from '@/lib/business'
import { LegalContact } from '@/components/shared/LegalContact'

export const metadata = { title: 'Dispute Resolution Policy — Rentivo' }

export default function DisputesPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Dispute Resolution Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 12, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">1. What this covers</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Two different kinds of disagreement, handled differently:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              <span className="font-semibold">Between a renter and a host</span> — the condition
              of the gear, a late return, a deposit, loss or damage. Rentivo is not a party to
              the rental, so these are settled between the two of you, with the help described
              below.
            </li>
            <li>
              <span className="font-semibold">Between you and Rentivo</span> — a service fee, a
              commission bill, a refund we owe you, or an account we have suspended or removed.
              These are ours to resolve.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">2. Step one: raise it with the other party</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            For anything about a specific rental, write to the other party in the booking&apos;s{' '}
            <Link href="/dashboard/messages" className="text-[#003049] underline">
              message thread
            </Link>
            . Most disagreements are a misunderstanding about time or condition and end there.
            Keeping it in the thread also creates the record we will read if it comes to us —
            photos of the equipment at pickup and at return are worth more than any later
            description of them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">3. Step two: bring it to us</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If that does not settle it, email{' '}
            <a href={`mailto:${BUSINESS.email}`} className="text-[#003049] underline">
              {BUSINESS.email}
            </a>{' '}
            with your booking reference, what happened, and what you want to happen. We aim to
            acknowledge within {BUSINESS.responseTime} and to reach a decision within 15 business
            days. We will ask the other party for their account before deciding anything, and we
            will tell you both what we decided and why.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">4. What we can and cannot do</h2>
          <p className="text-sm text-gray-700 leading-relaxed">We can:</p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>Review the booking record and the messages between you.</li>
            <li>
              Refund a payment Rentivo actually processed, where this policy or the{' '}
              <Link href="/refunds" className="text-[#003049] underline">
                Return and Refund Policy
              </Link>{' '}
              allows it.
            </li>
            <li>Suspend or remove an account that breaks the Terms of Service.</li>
            <li>Cancel or waive a commission bill we issued in error.</li>
          </ul>
          <p className="text-sm text-gray-700 leading-relaxed">We cannot:</p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              Decide who owes whom for loss or damage. Rentivo runs no insurance and no
              damage-claims process, and does not hold a deposit it could pay out from.
            </li>
            <li>
              Refund money paid straight to a host&apos;s own GCash or Maya QR code — Rentivo
              never received it and cannot reverse it.
            </li>
            <li>Compel either party to hand over equipment or money. Only a court can do that.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">5. Disputing a charge with your bank</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If you dispute a Rentivo charge with your card issuer or e-wallet provider, please
            tell us at the same time. Your provider will ask PayMongo for evidence, and we will
            supply the booking record. Writing to us first is usually faster, because we can
            refund a payment we hold directly, while a chargeback takes weeks and is decided by
            your provider rather than by us.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">6. If we still cannot resolve it</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Nothing on this page takes away a right you have under Philippine law. If you are not
            satisfied with how we handled your complaint, you can escalate it:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              <span className="font-semibold">Department of Trade and Industry (DTI)</span> — for
              consumer complaints about an online transaction, under the Consumer Act (RA 7394)
              and the Internet Transactions Act (RA 11967). See{' '}
              <a
                href="https://www.dti.gov.ph"
                target="_blank"
                rel="noreferrer"
                className="text-[#003049] underline"
              >
                dti.gov.ph
              </a>
              .
            </li>
            <li>
              <span className="font-semibold">National Privacy Commission (NPC)</span> — for a
              complaint about how your personal data was handled, under the Data Privacy Act (RA
              10173). See{' '}
              <a
                href="https://www.privacy.gov.ph"
                target="_blank"
                rel="noreferrer"
                className="text-[#003049] underline"
              >
                privacy.gov.ph
              </a>{' '}
              and our{' '}
              <Link href="/privacy" className="text-[#003049] underline">
                Privacy Policy
              </Link>
              .
            </li>
            <li>
              <span className="font-semibold">The courts of the Philippines</span> — these terms
              are governed by Philippine law, as stated in our{' '}
              <Link href="/terms" className="text-[#003049] underline">
                Terms of Service
              </Link>
              .
            </li>
          </ul>
        </section>

        <LegalContact purpose="a dispute or a complaint" />

        <section className="space-y-3">
          <p className="text-sm text-gray-700 leading-relaxed">
            This page describes how Rentivo actually works. It is not legal advice.
          </p>
        </section>
      </div>
    </div>
  )
}
