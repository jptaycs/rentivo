// The public origin for absolute URLs (metadata, sitemap, JSON-LD). Reads
// NEXT_PUBLIC_APP_URL, which is set to https://rentivo.live in production and
// http://localhost:3000 in dev. Client-safe.
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')

export const SITE_NAME = 'Rentivo'
export const SITE_TAGLINE = 'Rent Smarter. Create More.'
export const SITE_DESCRIPTION =
  'Rent cameras, lenses and smartphones from verified owners across the Philippines. Pay securely online, pick up locally.'

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
