import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { MOCK_LISTINGS, MOCK_BUNDLES } from '@/lib/mock-data'
import type { Listing } from '@/types'

function mockBundleAsListing(b: (typeof MOCK_BUNDLES)[number]): Listing {
  return {
    id: b.id,
    host_id: 'host1',
    category: 'bundle',
    brand: '',
    model: '',
    title: b.title,
    description: '',
    condition: 'excellent',
    daily_price: b.daily_price,
    weekly_price: null,
    monthly_price: null,
    security_deposit: 0,
    city: 'Manila',
    province: 'Metro Manila',
    is_instant_book: true,
    is_active: true,
    rating: null,
    review_count: 0,
    images: [b.image],
    accessories: b.items,
    created_at: '2024-01-01',
  }
}

export interface ListingSearchParams {
  query?: string
  category?: string
  brand?: string
  city?: string
  minPrice?: number
  maxPrice?: number
  instantBook?: boolean
  verified?: boolean
  minRating?: number
}

const HOST_SELECT = '*, host:profiles!listings_host_id_fkey(*)'

export async function getFeaturedListings(limit = 6): Promise<Listing[]> {
  if (!isSupabaseConfigured()) return MOCK_LISTINGS.slice(0, limit)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(HOST_SELECT)
    .eq('is_active', true)
    .eq('is_draft', false)
    .neq('category', 'bundle')
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`Failed to load featured listings: ${error.message}`)
  return data as Listing[]
}

export async function getPopularListings(limit = 12): Promise<Listing[]> {
  if (!isSupabaseConfigured()) return MOCK_LISTINGS.slice(0, limit)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(HOST_SELECT)
    .eq('is_active', true)
    .eq('is_draft', false)
    .neq('category', 'bundle')
    .order('review_count', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Failed to load popular listings: ${error.message}`)
  return data as Listing[]
}

export async function getBundles(limit = 6): Promise<Listing[]> {
  if (!isSupabaseConfigured()) return MOCK_BUNDLES.slice(0, limit).map(mockBundleAsListing)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(HOST_SELECT)
    .eq('is_active', true)
    .eq('is_draft', false)
    .eq('category', 'bundle')
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`Failed to load bundles: ${error.message}`)
  return data as Listing[]
}

export async function getActiveListingCount(): Promise<number> {
  if (!isSupabaseConfigured()) return MOCK_LISTINGS.length
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('is_draft', false)
  if (error) throw new Error(`Failed to count listings: ${error.message}`)
  return count ?? 0
}

export async function getListing(id: string): Promise<Listing | null> {
  if (!isSupabaseConfigured()) return MOCK_LISTINGS.find((l) => l.id === id) ?? null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('listings')
    .select(HOST_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    // Invalid UUIDs (e.g. stale localStorage ids) surface as 22P02 — treat as not found
    if (error.code === '22P02') return null
    throw new Error(`Failed to load listing: ${error.message}`)
  }
  return data as Listing | null
}

export async function searchListings(params: ListingSearchParams): Promise<Listing[]> {
  if (!isSupabaseConfigured()) return MOCK_LISTINGS
  const supabase = await createClient()

  let q = supabase
    .from('listings')
    .select('*, host:profiles!listings_host_id_fkey!inner(*)')
    .eq('is_active', true)
    .eq('is_draft', false)

  if (params.query) {
    const escaped = params.query.replace(/[%_,()]/g, '')
    q = q.or(`title.ilike.%${escaped}%,brand.ilike.%${escaped}%,model.ilike.%${escaped}%`)
  }
  if (params.category) q = q.eq('category', params.category)
  if (params.brand) q = q.eq('brand', params.brand)
  if (params.city) q = q.ilike('city', `%${params.city}%`)
  if (params.minPrice) q = q.gte('daily_price', params.minPrice)
  if (params.maxPrice && params.maxPrice < 99999) q = q.lte('daily_price', params.maxPrice)
  if (params.instantBook) q = q.eq('is_instant_book', true)
  if (params.verified) q = q.eq('host.is_verified', true)
  if (params.minRating) q = q.gte('rating', params.minRating)

  const { data, error } = await q.limit(60)
  if (error) throw new Error(`Failed to search listings: ${error.message}`)
  return data as Listing[]
}
