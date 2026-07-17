'use client'

import { useEffect, useRef } from 'react'
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Listing } from '@/types'

export function ViewTracker({ listing }: { listing: Listing }) {
  const { addItem } = useRecentlyViewed()
  const tracked = useRef(false)

  useEffect(() => {
    addItem(listing)
    if (tracked.current || !isSupabaseConfigured()) return
    tracked.current = true
    createClient().rpc('increment_listing_view', { p_listing_id: listing.id })
  }, [listing.id])

  return null
}
