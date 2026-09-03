'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { HostBill } from '@/types'

const BILL_SELECT =
  'id, host_id, period, amount, status, issued_at, due_at, paid_at, paymongo_ref, void_reason, created_at, items:host_bill_items(id, bill_id, booking_id, amount, booking:bookings!host_bill_items_booking_id_fkey(booking_ref, pickup_date, return_date, rental_fee, paid_at))'

export function useHostBills() {
  const [bills, setBills] = useState<HostBill[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setBills([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setBills([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('host_bills')
      .select(BILL_SELECT)
      .eq('host_id', user.id)
      .order('period', { ascending: false })
    if (!error) setBills((data ?? []) as unknown as HostBill[])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  const outstanding = useMemo(
    () => bills.filter((b) => b.status === 'issued').reduce((s, b) => s + b.amount, 0),
    [bills]
  )

  /** `{ status: 'paid' }` happens when a previously-minted PayMongo intent
   *  already succeeded by the time of this click (e.g. a second click after
   *  the webhook already landed) — the route marks the bill paid directly
   *  and returns no QR, since there is nothing left to scan. */
  async function pay(id: string): Promise<{ qrImage: string } | { status: 'paid' } | { error: string }> {
    const res = await fetch(`/api/bills/${id}/pay`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { error: json.error ?? 'Could not start the payment. Please try again.' }
    if (json.status === 'paid') return { status: 'paid' }
    return { qrImage: json.qrImage as string }
  }

  async function verify(id: string): Promise<'paid' | 'processing' | 'unpaid' | 'error'> {
    const res = await fetch(`/api/bills/${id}/verify-payment`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return 'error'
    return json.status ?? 'unpaid'
  }

  return { bills, loading, outstanding, reload, pay, verify }
}
