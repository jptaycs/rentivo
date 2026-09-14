'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { PayoutRequest } from '@/types'

// The host's own payout statements, read under the SELECT-own RLS policy.
//
// Payouts are admin-issued since migration 082 — a host no longer asks for
// one, so `requestPayout` is gone (the RPC behind it is now a stub that
// raises). `availableBalance`/`pendingPayout` are gone with it: they were a
// third, wrong copy of the eligibility rule (rental_fee only, no delivery
// fees, no host_qr/test_skip exclusion, no return-date rule). The one
// definition now lives in SQL and is read by usePayoutBalance().
export function usePayoutRequests() {
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [loading, setLoading] = useState(true)

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  const hasPendingRequest = requests.some((r) => r.status === 'pending')

  return { requests, loading, hasPendingRequest, reload }
}
