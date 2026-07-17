'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Booking } from '@/types'

export type BookingWithRefs = Booking & { booking_ref: string }

const BOOKING_SELECT = `*,
  listing:listings!bookings_listing_id_fkey(*),
  renter:profiles!bookings_renter_id_fkey(*),
  host:profiles!bookings_host_id_fkey(*)`

function useBookingsBy(column: 'renter_id' | 'host_id') {
  const [bookings, setBookings] = useState<BookingWithRefs[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setBookings([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setBookings([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq(column, user.id)
      .order('pickup_date', { ascending: false })
    if (!error) setBookings((data ?? []) as unknown as BookingWithRefs[])
    setLoading(false)
  }, [column])

  useEffect(() => {
    reload()
  }, [reload])

  return { bookings, loading, reload }
}

/** Bookings I made as a renter */
export function useMyRentals() {
  return useBookingsBy('renter_id')
}

/** Bookings on my listings as a host */
export function useHostBookings() {
  const base = useBookingsBy('host_id')

  async function setStatus(bookingId: string, status: 'confirmed' | 'cancelled') {
    const res = await fetch(`/api/bookings/${bookingId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return data?.error ?? 'Something went wrong.'
    await base.reload()
    return null
  }

  return { ...base, setStatus }
}
