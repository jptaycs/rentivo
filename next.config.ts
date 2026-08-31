import type { NextConfig } from 'next'

// script-src/style-src need 'unsafe-inline' for Next.js's inline RSC-hydration
// scripts and inline styles — a strict nonce-based CSP would need per-request
// nonces threaded through proxy.ts, out of scope for this defense-in-depth pass.
// Dev-only 'unsafe-eval': Next's dev-mode webpack HMR wraps every module in
// eval() (the eval-source-map devtool) — without this, no client-side JS runs
// at all in `next dev` (forms, buttons, everything dead). Production Next.js
// never uses eval(), so this stays out of the production policy.
const isDev = process.env.NODE_ENV !== 'production'
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // images.unsplash.com: seed data; *.supabase.co: storage buckets (listing/
  // avatar/message images); *.tile.openstreetmap.org: pickup + search maps;
  // lh3.googleusercontent.com: Google OAuth avatars, rendered via a plain
  // <img> (Radix Avatar) so next/image's remotePatterns doesn't cover it
  "img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co https://*.tile.openstreetmap.org https://lh3.googleusercontent.com",
  "font-src 'self'",
  // *.supabase.co: auth/storage/RPC; wss: Realtime; api.paymongo.com: card
  // tokenization, called directly from the browser with the public key
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.paymongo.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
  // Only honored over HTTPS; harmless in local dev
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

export default nextConfig
