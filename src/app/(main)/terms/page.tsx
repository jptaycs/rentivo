import Link from 'next/link'

export const metadata = { title: 'Terms of Service — Rentivo' }

export default function TermsPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Terms of Service</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 8, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">1. Who you are contracting with</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo is operated by Appnado IT Solutions, a DTI- and BIR-registered business.
            These terms are an agreement between you and Appnado IT Solutions. For any question
            about these terms, contact{' '}
            <a href="mailto:jptayco1109@gmail.com" className="text-[#003049] underline">
              jptayco1109@gmail.com
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">2. What Rentivo is</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo is a venue that connects equipment owners with renters. Rentivo is not a
            party to any rental. It does not own, inspect, insure or guarantee any equipment
            listed, and it operates no damage-claims process. Any rental agreement — including
            the condition of the equipment, its return, and any damage or loss — is between the
            host and the renter directly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">3. Eligibility</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>You must be at least 18 years old to create an account or make a booking.</li>
            <li>The information on your account and profile must be accurate and kept up to date.</li>
            <li>Each person may hold only one account.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">4. What may be listed</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo lists cameras, lenses and smartphones only. Drones, laptops, gaming consoles
            and vehicles may not be listed, regardless of category.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">5. Host verification</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Before a host&apos;s listings appear on the marketplace, Rentivo reviews a government
            ID and a selfie submitted by the host. A listing stays hidden from renters until that
            review is approved.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">6. Fees</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>Rentivo charges a 5% service fee on the rental amount only.</li>
            <li>Delivery fees, where a host offers delivery, are set by the host and paid to the host in full — Rentivo does not take a commission on delivery.</li>
            <li>Security deposits, where a host requires one, are arranged directly between the host and the renter and collected by the host at pickup. Rentivo does not charge, hold or return security deposits.</li>
            <li>
              Hosts who are paid directly by the renter&apos;s GCash or Maya QR code are billed
              the 5% service fee separately, on a monthly basis. See{' '}
              <Link href="/host-terms" className="text-[#003049] underline">
                Host Terms
              </Link>{' '}
              for how that billing works.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">7. Suspension and termination</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo may suspend or remove an account for breach of these terms, misrepresentation
            of equipment or identity, fraud, circumventing Rentivo to arrange payment off-platform,
            or unpaid amounts owed to Rentivo.
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>A suspended account is blocked from signing in.</li>
            <li>A suspended host&apos;s listings are hidden from the marketplace, and payouts to that host stop.</li>
            <li>
              An account cannot be deleted while it has a booking in progress, a payout request
              awaiting processing, or an unpaid commission bill — deletion is available again once
              those are resolved.
            </li>
            <li>
              Where an account is deleted, Rentivo anonymizes the profile rather than erasing it,
              because other users&apos; bookings, reviews and messages reference it — booking and
              review history is preserved for the counterparty.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">8. Prohibited conduct</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>Circumventing Rentivo to avoid its fees, including arranging payment off-platform for a booking made through Rentivo.</li>
            <li>Misrepresenting the equipment listed, its condition, or your identity.</li>
            <li>Sub-renting equipment you have rented through Rentivo to a third party.</li>
            <li>Harassment, threats, or abusive conduct toward another user or toward Rentivo staff.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">9. Limitation of liability</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            To the extent permitted by Philippine law, Rentivo&apos;s liability arising from your
            use of the platform is limited to the fees you paid to Rentivo for the booking giving
            rise to the claim. Rentivo is not liable for the acts or omissions of hosts or
            renters, for the condition of any equipment listed, or for disputes between a host and
            a renter — see Section 2.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">10. Governing law</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            These terms are governed by the laws of the Philippines. For how cancellations are
            handled, see{' '}
            <Link href="/cancellation" className="text-[#003049] underline">
              Cancellation Policy
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">11. Changes</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo may update these terms as the platform changes. The &quot;Last updated&quot;
            date at the top of this page reflects the most recent revision. Continued use of
            Rentivo after a change takes effect means you accept the updated terms.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            This page describes how Rentivo actually works. It is not legal advice.
          </p>
        </section>
      </div>
    </div>
  )
}
