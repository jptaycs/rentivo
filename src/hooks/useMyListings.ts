'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Listing } from '@/types'

const HOST_SELECT = '*, host:profiles!listings_host_id_fkey(*)'

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
    if (!error) setListings((data as Listing[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
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
