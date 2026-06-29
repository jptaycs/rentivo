import Link from 'next/link'
import Image from 'next/image'

export function Footer() {
  return (
    <footer className="bg-[#111827] text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-3">
              <Image src="/rentivo-logo.png" alt="Rentivo" width={150} height={48} className="h-11 w-auto object-contain brightness-0 invert" />
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
              {['Become a Host', 'Host Dashboard', 'Host Resources', 'Payouts'].map((l) => (
                <li key={l}><Link href="/host/new" className="hover:text-white transition-colors">{l}</Link></li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white text-sm font-semibold mb-3">Support</h4>
            <ul className="space-y-2 text-sm">
              {['Help Center', 'Safety', 'Cancellations', 'Contact Us'].map((l) => (
                <li key={l}><Link href="#" className="hover:text-white transition-colors">{l}</Link></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs">© 2026 Rentivo. All rights reserved.</p>
          <div className="flex gap-4 text-xs">
            <Link href="#" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-white transition-colors">Terms</Link>
            <Link href="#" className="hover:text-white transition-colors">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
