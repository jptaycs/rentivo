'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Review } from '@/types'

/** Reviews written about the signed-in user, by either party. */
export function useMyReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
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
        .select('*, reviewer:profiles!reviews_reviewer_id_fkey(*), listing:listings(*)')
        .eq('reviewee_id', user.id)
        .order('created_at', { ascending: false })
      setReviews((data as Review[]) ?? [])
      setLoading(false)
    })()
  }, [])

  return { reviews, loading }
}
