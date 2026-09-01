'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'
import type { Booking } from '@/types'

export type BookingWithRefs = Booking & { booking_ref: string }

// The bare leading `*` is on `bookings` itself (required — e.g. `delivery_fee`
// comes from it). The two joins use the project's public-safe column
// allowlists instead of `(*)`: a merely PENDING booking's listing/profile join
// otherwise hands the counterparty `street_address`/`serial_number`/
// `qr_payment_label` before the host has even confirmed — see AGENTS.md's
// street_address/qr_payment_label leak history.
const BOOKING_SELECT = `*,
  listing:listings!bookings_listing_id_fkey(${LISTING_COLUMNS}),
  renter:profiles!bookings_renter_id_fkey(${PROFILE_COLUMNS}),
  host:profiles!bookings_host_id_fkey(${PROFILE_COLUMNS})`

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  return { bookings, loading, reload }
}

async function respondToBooking(bookingId: string, status: 'confirmed' | 'cancelled') {
  const res = await fetch(`/api/bookings/${bookingId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) return data?.error ?? 'Something went wrong.'
  return null
}

/** Bookings I made as a renter */
export function useMyRentals() {
  const base = useBookingsBy('renter_id')

  async function cancel(bookingId: string) {
    const err = await respondToBooking(bookingId, 'cancelled')
    if (!err) await base.reload()
    return err
  }

  return { ...base, cancel }
}

/** Bookings on my listings as a host */
export function useHostBookings() {
  const base = useBookingsBy('host_id')

  async function setStatus(bookingId: string, status: 'confirmed' | 'cancelled') {
    const err = await respondToBooking(bookingId, status)
    if (!err) await base.reload()
    return err
  }

  async function confirmQrPayment(bookingId: string) {
    const supabase = createClient()
    const { error } = await supabase.rpc('confirm_host_qr_payment', { p_booking_id: bookingId })
    if (error) return error.message.replace(/^.*?: /, '')
    fetch(`/api/bookings/${bookingId}/notify-qr-paid`, { method: 'POST' }).catch((e) =>
      console.error('[email] notify-qr-paid failed', e)
    )
    await base.reload()
    return null
  }

  return { ...base, setStatus, confirmQrPayment }
}
