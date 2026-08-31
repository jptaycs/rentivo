'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface AvailabilityBlock {
  listing_id: string
  blocked_on: string
  reason: string
}

/** Availability blocks for a set of listings, with host-only manual add/remove. */
export function useAvailabilityBlocks(listingIds: string[]) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const key = listingIds.slice().sort().join(',')

  const reload = useCallback(async () => {
    if (listingIds.length === 0) {
      setBlocks([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data, error } = await supabase
      .from('availability_blocks')
      .select('listing_id, blocked_on, reason')
      .in('listing_id', listingIds)
    if (!error) setBlocks(data ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    setLoading(true)
    reload()
  }, [reload])

  function blockFor(listingId: string, dateKey: string) {
    return blocks.find((b) => b.listing_id === listingId && b.blocked_on === dateKey) ?? null
  }

  async function toggle(listingId: string, dateKey: string) {
    setError('')
    const existing = blockFor(listingId, dateKey)
    if (existing?.reason === 'booked') {
      setError('This date is already booked and cannot be unblocked here.')
      return
    }

    const supabase = createClient()
    if (existing) {
      const { error } = await supabase
        .from('availability_blocks')
        .delete()
        .eq('listing_id', listingId)
        .eq('blocked_on', dateKey)
      if (error) {
        setError(error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('availability_blocks')
        .insert({ listing_id: listingId, blocked_on: dateKey, reason: 'manual' })
      if (error) {
        setError(error.message)
        return
      }
    }
    await reload()
  }

  return { blocks, loading, error, toggle, blockFor }
}
