import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { QueryProvider } from '@/lib/query-client'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Rentivo — Rent Smarter. Create More.',
  description:
    'The most trusted marketplace for renting cameras, smartphones, and lenses in the Philippines.',
  keywords: ['camera rental', 'lens rental', 'smartphone rental', 'Philippines'],
  // Tab/home-screen icons come from the file conventions in this folder
  // (favicon.ico, icon.png, apple-icon.png) — the aperture mark from the logo,
  // since the full wordmark is unreadable at 16px.
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#F8FAFC] text-[#111827]">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
