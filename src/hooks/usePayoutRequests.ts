'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { useHostBookings } from './useBookings'
import type { PayoutRequest } from '@/types'

export function usePayoutRequests() {
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [loading, setLoading] = useState(true)
  const { bookings, loading: bookingsLoading, reload: reloadBookings } = useHostBookings()

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setRequests([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setRequests([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('payout_requests')
      .select('*, items:payout_items(*)')
      .eq('host_id', user.id)
      .order('requested_at', { ascending: false })
    if (!error) setRequests((data ?? []) as unknown as PayoutRequest[])
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const claimedBookingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of requests) {
      if (r.status === 'pending' || r.status === 'paid') {
        for (const item of r.items ?? []) ids.add(item.booking_id)
      }
    }
    return ids
  }, [requests])

  const availableBalance = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'completed' && b.payment_status === 'paid' && !claimedBookingIds.has(b.id))
        .reduce((sum, b) => sum + b.rental_fee, 0),
    [bookings, claimedBookingIds]
  )

  const pendingPayout = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'confirmed' || b.status === 'active')
        .reduce((sum, b) => sum + b.rental_fee, 0),
    [bookings]
  )

  const hasPendingRequest = requests.some((r) => r.status === 'pending')

  async function requestPayout() {
    const supabase = createClient()
    const { error } = await supabase.rpc('request_payout')
    if (error) return error.message
    await Promise.all([reload(), reloadBookings()])
    return null
  }

  return {
    requests,
    loading: loading || bookingsLoading,
    availableBalance,
    pendingPayout,
    hasPendingRequest,
    requestPayout,
    reload,
  }
}
