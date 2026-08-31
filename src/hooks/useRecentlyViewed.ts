'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LISTING_COLUMNS } from '@/lib/listing-columns'
import { useUser } from './useUser'
import type { Listing } from '@/types'

const KEY = 'rentivo_recently_viewed'
const MAX = 8

/**
 * Guests: localStorage only (unchanged). Logged in: a thin
 * (user_id, listing_id) table — reads join live listings, so unlike
 * the localStorage cache there's no stale-data risk. Any guest
 * history is migrated into the table once on first sign-in.
 */
export function useRecentlyViewed() {
  const [items, setItems] = useState<Listing[]>([])
  const { user, configured } = useUser()
  const live = configured && !!user
  const synced = useRef(false)

  useEffect(() => {
    if (live) return
    try {
      const stored = localStorage.getItem(KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guest load-on-mount from localStorage; no test suite to safely verify a rewrite (see AGENTS.md)
      if (stored) setItems(JSON.parse(stored))
    } catch {}
  }, [live])

  useEffect(() => {
    if (!live || !user || synced.current) return
    synced.current = true
    const supabase = createClient()
    ;(async () => {
      let localIds: string[] = []
      try {
        const stored = localStorage.getItem(KEY)
        if (stored) localIds = (JSON.parse(stored) as Listing[]).map((l) => l.id)
      } catch {}
      if (localIds.length > 0) {
        await supabase
          .from('recently_viewed_listings')
          .upsert(
            localIds.map((listing_id) => ({ user_id: user.id, listing_id })),
            { onConflict: 'user_id,listing_id', ignoreDuplicates: true }
          )
        try {
          localStorage.removeItem(KEY)
        } catch {}
      }

      const { data } = await supabase
        .from('recently_viewed_listings')
        .select(`listing:listings(${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey(*))`)
        .eq('user_id', user.id)
        .order('viewed_at', { ascending: false })
        .limit(MAX)
      if (data) setItems(data.map((r) => r.listing).filter(Boolean) as unknown as Listing[])
    })()
  }, [live, user])

  const addItem = useCallback(
    (listing: Listing) => {
      setItems((prev) => {
        const updated = [listing, ...prev.filter((i) => i.id !== listing.id)].slice(0, MAX)
        if (!live) {
          try {
            localStorage.setItem(KEY, JSON.stringify(updated))
          } catch {}
        }
        return updated
      })
      if (live && user) {
        createClient()
          .from('recently_viewed_listings')
          .upsert(
            { user_id: user.id, listing_id: listing.id, viewed_at: new Date().toISOString() },
            { onConflict: 'user_id,listing_id' }
          )
          .then(({ error }) => {
            if (error) console.error('[recently-viewed] upsert failed', error)
          })
      }
    },
    [live, user]
  )

  const clearItems = useCallback(() => {
    setItems([])
    if (live && user) {
      createClient()
        .from('recently_viewed_listings')
        .delete()
        .eq('user_id', user.id)
        .then(({ error }) => {
          if (error) console.error('[recently-viewed] clear failed', error)
        })
      return
    }
    try {
      localStorage.removeItem(KEY)
    } catch {}
  }, [live, user])

  return { items, addItem, clearItems }
}
