import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listings'
import type { Listing, Profile, Review } from '@/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface HostProfileData {
  profile: Profile
  listings: Listing[]
  reviews: Review[]
  /** Falls back to the host's most common listing city when the profile has none */
  city: string | null
}

export async function getHostProfile(id: string): Promise<HostProfileData | null> {
  if (!isSupabaseConfigured() || !UUID_RE.test(id)) return null

  const supabase = await createClient()

  const [{ data: profile }, { data: listings }, { data: reviews }] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).eq('is_host', true).maybeSingle(),
    supabase
      .from('listings')
      .select(`${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey(${PROFILE_COLUMNS})`)
      .eq('host_id', id)
      .eq('is_active', true)
      .eq('is_draft', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('reviews')
      .select(`*, reviewer:profiles!reviews_reviewer_id_fkey(${PROFILE_COLUMNS})`)
      .eq('reviewee_id', id)
      .not('listing_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (!profile) return null

  const listingRows = (listings ?? []) as unknown as Listing[]
  return {
    profile: profile as Profile,
    listings: listingRows,
    reviews: (reviews ?? []) as Review[],
    city: (profile as Profile).city ?? listingRows[0]?.city ?? null,
  }
}
