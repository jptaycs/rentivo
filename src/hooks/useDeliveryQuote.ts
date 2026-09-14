'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * The server's delivery fee for a renter's pin. Debounced: dragging a pin fires
 * many changes. The quote is computed in Postgres by the same function
 * create_booking charges with, so what this returns is what the renter pays.
 */
export function useDeliveryQuote(
  listingId: string,
  pin: { lat: number; lng: number } | null,
  enabled: boolean
) {
  const [state, setState] = useState<{ fee: number | null; roadKm: number | null; loading: boolean; error: string | null }>(
    { fee: null, roadKm: null, loading: false, error: null }
  )

  useEffect(() => {
    if (!enabled || !pin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear a stale quote when the pin/eligibility goes away; the quote is external state keyed by the pin
      setState({ fee: null, roadKm: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    const t = setTimeout(async () => {
      const { data, error } = await createClient().rpc('quote_delivery_fee', {
        p_listing_id: listingId,
        p_delivery_lat: pin.lat,
        p_delivery_lng: pin.lng,
      })
      if (cancelled) return
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row) {
        setState({ fee: null, roadKm: null, loading: false, error: error?.message ?? 'Could not price delivery.' })
      } else {
        setState({ fee: row.fee, roadKm: row.road_km, loading: false, error: null })
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [listingId, pin?.lat, pin?.lng, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}
