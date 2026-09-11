import Link from 'next/link'
import { BUSINESS, BUSINESS_ADDRESS } from '@/lib/business'

/**
 * The "Who to contact" block every legal page closes with. One component so
 * the entity name, registration number, address and contact address can never
 * drift between pages — they had already drifted once when each page carried
 * its own copy.
 */
export function LegalContact({ purpose = 'this page' }: { purpose?: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-[#111827]">Who to contact</h2>
      <p className="text-sm text-gray-700 leading-relaxed">
        Rentivo is operated by {BUSINESS.name}, a DTI- and BIR-registered business in the
        Philippines (DTI Business Name Registration No. {BUSINESS.dtiNumber}), based in{' '}
        {BUSINESS_ADDRESS}. For questions about {purpose}, email{' '}
        <a href={`mailto:${BUSINESS.email}`} className="text-[#003049] underline">
          {BUSINESS.email}
        </a>
        , or see the{' '}
        <Link href="/contact" className="text-[#003049] underline">
          contact page
        </Link>
        .
      </p>
    </section>
  )
}
