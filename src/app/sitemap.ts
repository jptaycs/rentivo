import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'
import { CATEGORIES } from '@/lib/categories'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createPublicClient } from '@/lib/supabase/public'

// Regenerated at most hourly. Listing and host URLs come from the same
// anon-key, RLS-scoped read the storefront uses, so a draft, paused or
// suspended-host listing can never appear here.
export const revalidate = 3600

const STATIC_PATHS = [
  '/', '/search', '/contact', '/terms', '/privacy', '/refunds', '/rental-agreement',
  '/disputes', '/host-terms', '/signup', '/login',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === '/' || path === '/search' ? 'daily' : 'monthly',
    priority: path === '/' ? 1 : path === '/search' ? 0.9 : 0.4,
  }))

  for (const c of CATEGORIES) {
    entries.push({
      url: `${SITE_URL}/search?category=${c.value}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    })
  }

  if (!isSupabaseConfigured()) return entries

  const supabase = createPublicClient()
  const [{ data: listings }, { data: cities }] = await Promise.all([
    supabase
      .from('listings')
      .select('id, host_id, created_at, host:profiles!listings_host_id_fkey!inner(id)')
      .eq('is_active', true)
      .eq('is_draft', false)
      .is('host.suspended_at', null)
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from('listings')
      .select('city, host:profiles!listings_host_id_fkey!inner(id)')
      .eq('is_active', true)
      .eq('is_draft', false)
      .is('host.suspended_at', null),
  ])

  const hosts = new Set<string>()
  for (const l of listings ?? []) {
    entries.push({
      url: `${SITE_URL}/listings/${l.id}`,
      lastModified: new Date(l.created_at),
      changeFrequency: 'weekly',
      priority: 0.7,
    })
    hosts.add(l.host_id)
  }
  for (const id of hosts) {
    entries.push({ url: `${SITE_URL}/hosts/${id}`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 })
  }

  // One search URL per city that actually has live listings — never a city
  // with zero results, which would index as an empty page.
  const seen = new Set<string>()
  for (const row of cities ?? []) {
    const city = (row.city ?? '').trim()
    if (!city || seen.has(city.toLowerCase())) continue
    seen.add(city.toLowerCase())
    entries.push({
      url: `${SITE_URL}/search?city=${encodeURIComponent(city)}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.6,
    })
  }

  return entries
}
