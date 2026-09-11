import Link from 'next/link'
import { BUSINESS, BUSINESS_ADDRESS } from '@/lib/business'

export const metadata = { title: 'Contact Us — Rentivo' }

const DETAILS: [string, string][] = [
  ['Registered business name', BUSINESS.name],
  ['Trade name', 'Rentivo (rentivo.live)'],
  ['DTI Business Name Registration No.', BUSINESS.dtiNumber],
  ['Business address', BUSINESS_ADDRESS],
  ['Customer service email', BUSINESS.email],
]

export default function ContactPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Contact Us</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 12, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Customer service</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Email{' '}
            <a href={`mailto:${BUSINESS.email}`} className="text-[#003049] underline">
              {BUSINESS.email}
            </a>
            . One person reads that inbox, and we aim to reply within{' '}
            {BUSINESS.responseTime}. Email is the only support channel — Rentivo has no phone
            line and no live chat, so nothing is lost by writing rather than calling.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Business details</h2>
          <dl className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
            {DETAILS.map(([label, value]) => (
              <div key={label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-5 py-4">
                <dt className="text-xs uppercase tracking-wide text-gray-500 sm:w-64 shrink-0">{label}</dt>
                <dd className="text-sm text-gray-800 font-medium break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo is the marketplace operated by {BUSINESS.name}. Any agreement you enter into
            on this site — including these pages, your account, and the fees Rentivo charges — is
            with {BUSINESS.name}.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">What to include</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            So we can help on the first reply rather than the third, tell us:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>The email address on your Rentivo account.</li>
            <li>
              The booking reference if your question is about a rental — it looks like{' '}
              <span className="font-mono">RNT-A4DA55</span> and appears on your receipt and in
              your dashboard.
            </li>
            <li>What happened, and what you would like us to do about it.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Talking to the other party first</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If your question is about a specific rental — where to meet for pickup, the condition
            of the gear, a late return — message the host or renter directly in the booking&apos;s{' '}
            <Link href="/dashboard/messages" className="text-[#003049] underline">
              message thread
            </Link>
            . It is usually faster, and it leaves a record both of you can refer back to if you
            later need us to look at it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Where specific questions go</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              Cancellations, refunds, and returning equipment —{' '}
              <Link href="/refunds" className="text-[#003049] underline">
                Return and Refund Policy
              </Link>
              .
            </li>
            <li>
              A disagreement with a host, a renter, or with Rentivo —{' '}
              <Link href="/disputes" className="text-[#003049] underline">
                Dispute Resolution Policy
              </Link>
              .
            </li>
            <li>
              Your personal data, or a request to access or delete it —{' '}
              <Link href="/privacy" className="text-[#003049] underline">
                Privacy Policy
              </Link>
              .
            </li>
            <li>
              Hosting, payouts, and commission bills —{' '}
              <Link href="/host-terms" className="text-[#003049] underline">
                Host Terms
              </Link>
              .
            </li>
            <li>
              The rules of the platform itself —{' '}
              <Link href="/terms" className="text-[#003049] underline">
                Terms of Service
              </Link>
              .
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
