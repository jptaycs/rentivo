'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'
import type { Review } from '@/types'

/** Reviews written about the signed-in user, by either party. */
export function useMyReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- unconfigured bailout; no test suite to safely verify a rewrite (see AGENTS.md)
      setLoading(false)
      return
    }
    const supabase = createClient()
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('reviews')
        .select(
          `*, reviewer:profiles!reviews_reviewer_id_fkey(${PROFILE_COLUMNS}), listing:listings(${LISTING_COLUMNS})`
        )
        .eq('reviewee_id', user.id)
        .order('created_at', { ascending: false })
      setReviews((data as Review[]) ?? [])
      setLoading(false)
    })()
  }, [])

  return { reviews, loading }
}
