'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Profile } from '@/types'
import type { Message } from '@/types'

export interface ConversationHeader {
  bookingId: string
  bookingRef: string
  listingTitle: string
  otherUser: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
}

export function useConversation(bookingId: string | null) {
  const [header, setHeader] = useState<ConversationHeader | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!bookingId || !isSupabaseConfigured()) {
      setLoading(false)
      return
    }
    setLoading(true)
    setNotFound(false)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }
    setUserId(user.id)

    const { data } = await supabase
      .from('bookings')
      .select(
        'id, booking_ref, renter_id, host_id, listing:listings(title), renter:profiles!bookings_renter_id_fkey(*), host:profiles!bookings_host_id_fkey(*)'
      )
      .eq('id', bookingId)
      .maybeSingle()
    const booking = data as unknown as {
      id: string
      booking_ref: string
      renter_id: string
      host_id: string
      listing: { title: string } | null
      renter: Profile | null
      host: Profile | null
    } | null

    if (!booking) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const other = booking.renter_id === user.id ? booking.host : booking.renter
    if (!other) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setHeader({
      bookingId: booking.id,
      bookingRef: booking.booking_ref,
      listingTitle: booking.listing?.title ?? 'Rentivo booking',
      otherUser: other,
    })

    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true })
    setMessages(msgs ?? [])
    setLoading(false)

    const unreadIds = (msgs ?? []).filter((m) => m.sender_id !== user.id && !m.is_read).map((m) => m.id)
    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ is_read: true }).in('id', unreadIds)
    }
  }, [bookingId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    load()
  }, [load])

  useEffect(() => {
    if (!bookingId || !isSupabaseConfigured()) return
    const supabase = createClient()
    const channel = supabase
      .channel(`conversation:${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
        (payload) => {
          const msg = payload.new as Message
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
          if (msg.sender_id !== userId) {
            supabase.from('messages').update({ is_read: true }).eq('id', msg.id)
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [bookingId, userId])

  async function send(content: string, imageFile?: File): Promise<string | null> {
    if (!bookingId || !userId) return null
    if (!content.trim() && !imageFile) return null
    const supabase = createClient()

    let imageUrl: string | null = null
    if (imageFile) {
      const ext = imageFile.type.split('/')[1] ?? 'jpg'
      const path = `${userId}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('message-images')
        .upload(path, imageFile, { contentType: imageFile.type })
      if (uploadError) return uploadError.message
      imageUrl = supabase.storage.from('message-images').getPublicUrl(path).data.publicUrl
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({ booking_id: bookingId, sender_id: userId, content: content.trim(), image_url: imageUrl })
      .select()
      .single()
    if (!error && data) {
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
      fetch('/api/messages/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: data.id }),
      }).catch(() => {})
    }
    return error?.message ?? null
  }

  return { header, messages, userId, loading, notFound, send }
}
