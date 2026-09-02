'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'

/**
 * The dates one listing is unavailable, for the renter-facing booking calendar.
 *
 * Reads `availability_blocks` directly rather than through a new RPC: migration
 * 003 grants `availability blocks: public read using (true)` and its own comment
 * says "needed for calendar", so this is the read that policy was written for.
 * Only `blocked_on` is selected — `reason` distinguishes 'booked' from 'manual'
 * and a renter has no business knowing which of the two a host's blocked day is.
 *
 * Returns local `YYYY-MM-DD` keys. Postgres hands back a `date` column in
 * exactly that shape already, so no timezone conversion happens here — which is
 * the point, since converting through a Date would shift every key backwards a
 * day in UTC+8 (see toLocalISODate's warning in calendarUtils).
 */
export function useListingAvailability(listingId: string | null) {
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!listingId || !isSupabaseConfigured()) {
      setBlockedDates(new Set())
      setLoading(false)
      return
    }
    const today = new Date()
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const { data, error } = await createClient()
      .from('availability_blocks')
      .select('blocked_on')
      .eq('listing_id', listingId)
      .gte('blocked_on', todayKey)

    // On error, fail OPEN with an empty set: the calendar then shows every day
    // as selectable, and create_booking's own availability check still rejects a
    // genuinely unavailable range server-side. Failing closed would grey out a
    // whole listing's calendar because of a transient read error.
    if (!error) setBlockedDates(new Set((data ?? []).map((r) => r.blocked_on as string)))
    setLoading(false)
  }, [listingId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    setLoading(true)
    reload()
  }, [reload])

  return { blockedDates, loading, reload }
}
