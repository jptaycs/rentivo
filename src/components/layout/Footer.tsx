import Link from 'next/link'
import Image from 'next/image'
import { BUSINESS, BUSINESS_ADDRESS } from '@/lib/business'

export function Footer() {
  return (
    <footer className="bg-[#111827] text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-3">
              <Image src="/rentivo-logo-beige.png" alt="Rentivo" width={220} height={72} className="h-20 w-auto object-contain" />
            </Link>
            <p className="text-sm leading-relaxed">Rent Smarter. Create More.</p>
          </div>

          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Explore</h4>
            <ul className="space-y-2 text-sm">
              {['Cameras', 'Phones', 'Lenses', 'Creator Kits'].map((l) => (
                <li key={l}><Link href="/search" className="hover:text-white transition-colors">{l}</Link></li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Hosting</h4>
            <ul className="space-y-2 text-sm">
              {['Become a Host', 'Host Dashboard', 'Payouts'].map((l) => (
                <li key={l}><Link href="/host/new" className="hover:text-white transition-colors">{l}</Link></li>
              ))}
              <li><Link href="/host-terms" className="hover:text-white transition-colors">Host Terms</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Support</h4>
            <ul className="space-y-2 text-sm">
              {[
                { label: 'Contact Us', href: '/contact' },
                { label: 'Cancellations & Refunds', href: '/refunds' },
                { label: 'Disputes', href: '/disputes' },
                { label: 'Rental Agreement', href: '/rental-agreement' },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Legal</h4>
            <ul className="space-y-2 text-sm">
              {[
                { label: 'Terms of Service', href: '/terms' },
                { label: 'Privacy Policy', href: '/privacy' },
                { label: 'Return & Refund Policy', href: '/refunds' },
                { label: 'Dispute Resolution', href: '/disputes' },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Operator details. Published deliberately: the registration number,
            business address and a working contact address are what a payment
            processor's merchant review looks for — see src/lib/business.ts. */}
        <div className="border-t border-white/10 pt-6 space-y-3">
          <p className="text-xs leading-relaxed">
            Rentivo is operated by {BUSINESS.name} · DTI Business Name Registration No.{' '}
            {BUSINESS.dtiNumber} · {BUSINESS_ADDRESS} ·{' '}
            <a href={`mailto:${BUSINESS.email}`} className="hover:text-white transition-colors underline">
              {BUSINESS.email}
            </a>
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs">© 2026 {BUSINESS.name}. All rights reserved.</p>
            <div className="flex gap-4 text-xs">
              <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
              <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
