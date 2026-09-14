'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Listing } from '@/types'

/** Shown when a delete is refused because renters still depend on the listing. */
export const LISTING_KEPT_MESSAGE =
  'This listing has bookings or message threads that renters still need, so it can\'t be deleted. ' +
  'It has been deactivated instead and is hidden from search.'

/**
 * Delete a listing, or deactivate it when the database refuses the delete.
 *
 * Since migration 077, conversations.listing_id is ON DELETE RESTRICT (it used
 * to cascade, which let a host erase a renter's inquiry thread by deleting the
 * listing), and bookings/reviews have always blocked deletes the same way. All
 * of those surface as Postgres 23503 (foreign_key_violation). In that case the
 * listing is paused instead, so it still leaves the marketplace.
 *
 * Returns `{ error }` (a message to show) and `deactivated` (true when the
 * listing was kept but paused).
 */
export async function deleteOrDeactivateListing(
  supabase: SupabaseClient,
  listingId: string
): Promise<{ error: string | null; deactivated: boolean }> {
  const { error } = await supabase.from('listings').delete().eq('id', listingId)
  if (!error) return { error: null, deactivated: false }
  if (error.code !== '23503') return { error: error.message, deactivated: false }

  const { error: pauseError } = await supabase
    .from('listings')
    .update({ is_active: false })
    .eq('id', listingId)
  if (pauseError) return { error: pauseError.message, deactivated: false }
  return { error: null, deactivated: true }
}

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

  /** Returns an error message, LISTING_KEPT_MESSAGE when the listing was
   *  deactivated instead of deleted, or null when it was deleted. */
  async function remove(listingId: string) {
    const { error, deactivated } = await deleteOrDeactivateListing(createClient(), listingId)
    if (error) return error
    await reload()
    return deactivated ? LISTING_KEPT_MESSAGE : null
  }

  return { listings, loading, reload, setActive, remove }
}
