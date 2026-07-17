'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'

/** Booking ids the signed-in user has already reviewed. */
export function useReviewedBookings() {
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('reviews')
        .select('booking_id')
        .eq('reviewer_id', user.id)
      if (data) setReviewedIds(new Set(data.map((r) => r.booking_id)))
    })()
  }, [])

  const markReviewed = useCallback((bookingId: string) => {
    setReviewedIds((prev) => new Set(prev).add(bookingId))
  }, [])

  return { reviewedIds, markReviewed }
}
