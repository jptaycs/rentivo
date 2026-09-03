'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { PROFILE_COLUMNS } from '@/lib/listing-columns'
import type { Profile } from '@/types'

export interface MessageThread {
  conversationId: string
  bookingId: string | null
  bookingRef: string | null
  listingId: string
  listingTitle: string
  otherUser: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  lastMessage: string
  lastAt: string
  unreadCount: number
  isInquiry: boolean
}

interface ConversationRow {
  id: string
  listing_id: string
  renter_id: string
  host_id: string
  booking_id: string | null
  last_message_at: string
  listing: { title: string } | null
  booking: { booking_ref: string } | null
  renter: Profile | null
  host: Profile | null
}

interface MessageRow {
  conversation_id: string
  content: string
  image_url: string | null
  sender_id: string
  is_read: boolean
  created_at: string
}

/** One thread per conversation I'm party to, ordered by most recent message. */
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

    const { data: conversations } = await supabase
      .from('conversations')
      .select(
        `id, listing_id, renter_id, host_id, booking_id, last_message_at,
         listing:listings(title),
         booking:bookings(booking_ref),
         renter:profiles!conversations_renter_id_fkey(${PROFILE_COLUMNS}),
         host:profiles!conversations_host_id_fkey(${PROFILE_COLUMNS})`
      )
      .or(`renter_id.eq.${user.id},host_id.eq.${user.id}`)
      .order('last_message_at', { ascending: false })

    const rows = (conversations as unknown as ConversationRow[]) ?? []
    if (rows.length === 0) {
      setThreads([])
      setLoading(false)
      return
    }

    const conversationIds = rows.map((c) => c.id)
    const { data: messages } = await supabase
      .from('messages')
      .select('conversation_id, content, image_url, sender_id, is_read, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true })

    const byConversation = new Map<string, MessageRow[]>()
    for (const m of (messages as MessageRow[]) ?? []) {
      const list = byConversation.get(m.conversation_id) ?? []
      list.push(m)
      byConversation.set(m.conversation_id, list)
    }

    const built = rows
      .map((c): MessageThread | null => {
        const other = c.renter_id === user.id ? c.host : c.renter
        if (!other) return null
        const msgs = byConversation.get(c.id) ?? []
        // The old behaviour dropped any thread with zero messages. Keep that
        // filter only for booking threads — an inquiry always has at least
        // one message because create_inquiry inserts one.
        const isInquiry = c.booking_id === null
        if (!isInquiry && msgs.length === 0) return null
        const last = msgs[msgs.length - 1]
        return {
          conversationId: c.id,
          bookingId: c.booking_id,
          bookingRef: c.booking?.booking_ref ?? null,
          listingId: c.listing_id,
          listingTitle: c.listing?.title ?? 'Rentivo listing',
          otherUser: other,
          lastMessage: last ? last.content || (last.image_url ? '📷 Photo' : '') : '',
          lastAt: last?.created_at ?? c.last_message_at,
          unreadCount: msgs.filter((m) => m.sender_id !== user.id && !m.is_read).length,
          isInquiry,
        }
      })
      .filter((t): t is MessageThread => t !== null)
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())

    setThreads(built)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  // Live-update thread order/unread counts as new messages arrive anywhere
  useEffect(() => {
    if (!isSupabaseConfigured() || !userId) return
    const supabase = createClient()
    // Topic MUST be unique per mount. supabase-js dedupes channels by topic, so
    // a second concurrent mount calling .on() against the already-subscribed
    // channel throws "cannot add postgres_changes callbacks ... after
    // subscribe()" and takes the whole page down via the error boundary.
    // This was latent while /dashboard/messages was the only consumer; adding
    // the real unread badge to DashboardSidebar (which renders on every
    // dashboard route) made it a second concurrent mount and it crashed
    // immediately. useNotifications hit the identical bug and uses the same fix.
    const channel = supabase
      .channel(`threads:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => reload())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, reload])

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0)

  return { threads, loading, userId, totalUnread, reload }
}
