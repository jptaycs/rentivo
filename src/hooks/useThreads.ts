'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Profile } from '@/types'

export interface MessageThread {
  bookingId: string
  bookingRef: string
  listingTitle: string
  otherUser: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  lastMessage: string
  lastAt: string
  unreadCount: number
}

interface BookingRow {
  id: string
  booking_ref: string
  renter_id: string
  host_id: string
  listing: { title: string } | null
  renter: Profile | null
  host: Profile | null
}

/** One thread per booking I'm party to, ordered by most recent message. */
export function useThreads() {
  const [threads, setThreads] = useState<MessageThread[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }
    setUserId(user.id)

    const { data: bookings } = await supabase
      .from('bookings')
      .select(
        'id, booking_ref, renter_id, host_id, listing:listings(title), renter:profiles!bookings_renter_id_fkey(*), host:profiles!bookings_host_id_fkey(*)'
      )
      .or(`renter_id.eq.${user.id},host_id.eq.${user.id}`)

    const rows = (bookings as unknown as BookingRow[]) ?? []
    if (rows.length === 0) {
      setThreads([])
      setLoading(false)
      return
    }

    const bookingIds = rows.map((b) => b.id)
    const { data: messages } = await supabase
      .from('messages')
      .select('booking_id, content, sender_id, is_read, created_at')
      .in('booking_id', bookingIds)
      .order('created_at', { ascending: true })

    const byBooking = new Map<string, typeof messages>()
    for (const m of messages ?? []) {
      const list = byBooking.get(m.booking_id) ?? []
      list.push(m)
      byBooking.set(m.booking_id, list)
    }

    const built = rows
      .map((b): MessageThread | null => {
        const msgs = byBooking.get(b.id) ?? []
        if (msgs.length === 0) return null
        const last = msgs[msgs.length - 1]
        const other = b.renter_id === user.id ? b.host : b.renter
        if (!other) return null
        return {
          bookingId: b.id,
          bookingRef: b.booking_ref,
          listingTitle: b.listing?.title ?? 'Rentivo booking',
          otherUser: other,
          lastMessage: last.content,
          lastAt: last.created_at,
          unreadCount: msgs.filter((m) => m.sender_id !== user.id && !m.is_read).length,
        }
      })
      .filter((t): t is MessageThread => t !== null)
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())

    setThreads(built)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Live-update thread order/unread counts as new messages arrive anywhere
  useEffect(() => {
    if (!isSupabaseConfigured() || !userId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`threads:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => reload())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, reload])

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0)

  return { threads, loading, userId, totalUnread, reload }
}
