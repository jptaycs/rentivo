import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// Public storefront is crawlable; everything behind a session, every API
// route and the checkout are not. /book is excluded because a crawler can't
// hold a booking and its URLs carry dates that would index as junk.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/dashboard', '/book', '/messages', '/auth/', '/host/new'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
