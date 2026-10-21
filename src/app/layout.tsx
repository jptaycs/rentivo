import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { QueryProvider } from '@/lib/query-client'
import { NavProgress } from '@/components/layout/NavProgress'
import { Analytics } from '@vercel/analytics/next'
import { SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from '@/lib/site'
import { BUSINESS, BUSINESS_ADDRESS } from '@/lib/business'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: ['camera rental', 'lens rental', 'smartphone rental', 'Philippines', 'rent a camera', 'camera for rent'],
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_PH',
    url: SITE_URL,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
  // Tab/home-screen icons come from the file conventions in this folder
  // (favicon.ico, icon.png, apple-icon.png) — the aperture mark from the logo,
  // since the full wordmark is unreadable at 16px.
}

// Organization + WebSite structured data, once, on every page. The search
// action tells Google that /search?q= is the site's own search box.
const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      legalName: BUSINESS.name,
      url: SITE_URL,
      logo: `${SITE_URL}/rentivo-logo.png`,
      email: BUSINESS.email,
      address: {
        '@type': 'PostalAddress',
        addressLocality: BUSINESS.city,
        addressRegion: BUSINESS.province,
        addressCountry: 'PH',
      },
      description: `${SITE_DESCRIPTION} Operated by ${BUSINESS.name}, ${BUSINESS_ADDRESS}.`,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      publisher: { '@id': `${SITE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#F8FAFC] text-[#111827]">
        <NavProgress />
        <QueryProvider>{children}</QueryProvider>
        <script
          type="application/ld+json"
          // JSON.stringify output of our own constants — no user input reaches this.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
        />
        <Analytics />
      </body>
    </html>
  )
}
