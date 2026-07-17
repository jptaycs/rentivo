'use client'

import { useEffect, useRef } from 'react'
import { useWishlistStore } from '@/store/wishlist'
import { createClient } from '@/lib/supabase/client'
import { useUser } from './useUser'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Wishlist backed by the zustand store (localStorage for guests) and
 * synced to the `wishlist` table once signed in. Hearts saved while
 * logged out are migrated to the account on first sign-in.
 */
export function useWishlist() {
  const ids = useWishlistStore((s) => s.ids)
  const { user, configured } = useUser()
  const synced = useRef(false)

  const live = configured && !!user

  useEffect(() => {
    if (!live || synced.current) return
    synced.current = true
    const supabase = createClient()
    ;(async () => {
      const local = useWishlistStore.getState().ids.filter((id) => UUID_RE.test(id))
      if (local.length > 0) {
        await supabase.from('wishlist').upsert(
          local.map((listing_id) => ({ user_id: user.id, listing_id })),
          { onConflict: 'user_id,listing_id', ignoreDuplicates: true }
        )
      }
      const { data } = await supabase.from('wishlist').select('listing_id')
      if (data) useWishlistStore.getState().setIds(data.map((r) => r.listing_id))
    })()
  }, [live, user])

  async function toggle(id: string) {
    const store = useWishlistStore.getState()
    const had = store.ids.includes(id)
    store.toggle(id)
    if (!live || !UUID_RE.test(id)) return

    const supabase = createClient()
    const { error } = had
      ? await supabase.from('wishlist').delete().eq('user_id', user.id).eq('listing_id', id)
      : await supabase.from('wishlist').insert({ user_id: user.id, listing_id: id })
    if (error) useWishlistStore.getState().toggle(id) // revert optimistic update
  }

  return { ids, toggle, has: (id: string) => ids.includes(id), live }
}
