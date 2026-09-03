'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Listing } from '@/types'

// Scoped to the caller's own listings, so the joined profile is their own and
// this was never a cross-user leak — but `(*)` is the anti-pattern this repo
// has been bitten by twice, and only `host.is_verified` is ever read.
const HOST_SELECT = `${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey(${PROFILE_COLUMNS})`

/** All of the signed-in host's own listings, including paused/draft ones. */
export function useMyListings() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setListings([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setListings([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('listings')
      .select(HOST_SELECT)
      .eq('host_id', user.id)
      .order('created_at', { ascending: false })
    if (!error) setListings((data as unknown as Listing[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  async function setActive(listingId: string, isActive: boolean) {
    const supabase = createClient()
    const { error } = await supabase
      .from('listings')
      .update({ is_active: isActive })
      .eq('id', listingId)
    if (error) return error.message
    await reload()
    return null
  }

  async function remove(listingId: string) {
    const supabase = createClient()
    const { error } = await supabase.from('listings').delete().eq('id', listingId)
    if (error) return error.message
    await reload()
    return null
  }

  return { listings, loading, reload, setActive, remove }
}
