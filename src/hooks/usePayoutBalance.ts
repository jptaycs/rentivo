'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'

// What Rentivo owes this host right now, from `my_payout_balance()` (082) —
// the ONE definition of eligibility, scoped to auth.uid() inside the function.
// This replaced a third, wrong client-side mirror in usePayoutRequests that
// summed rental_fee only, omitting delivery fees, the host_qr/test_skip
// exclusions and 077's return-date rule.
export function usePayoutBalance() {
  const [bookings, setBookings] = useState(0)
  const [amount, setAmount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setBookings(0)
      setAmount(0)
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('my_payout_balance')
    if (rpcError) {
      // Never fall through to ₱0 on a failed read — a host seeing zero would
      // conclude they are owed nothing, which is a different claim entirely.
      setError(rpcError.message)
      setLoading(false)
      return
    }
    const row = (data as { bookings: number; amount: number }[] | null)?.[0]
    setError(null)
    setBookings(row?.bookings ?? 0)
    setAmount(row?.amount ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  return { bookings, amount, loading, error, reload }
}
