'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { PROFILE_COLUMNS } from '@/lib/listing-columns'
import type { Profile } from '@/types'
import type { Message } from '@/types'

export interface ConversationHeader {
  conversationId: string
  bookingId: string | null
  bookingRef: string | null
  listingId: string
  listingTitle: string
  otherUser: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
}

interface ConversationRow {
  id: string
  listing_id: string
  renter_id: string
  host_id: string
  booking_id: string | null
  listing: { title: string } | null
  booking: { booking_ref: string } | null
  renter: Profile | null
  host: Profile | null
}

export function useConversation(conversationId: string | null) {
  const [header, setHeader] = useState<ConversationHeader | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!conversationId || !isSupabaseConfigured()) {
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
      .from('conversations')
      .select(
        `id, listing_id, renter_id, host_id, booking_id,
         listing:listings(title),
         booking:bookings(booking_ref),
         renter:profiles!conversations_renter_id_fkey(${PROFILE_COLUMNS}),
         host:profiles!conversations_host_id_fkey(${PROFILE_COLUMNS})`
      )
      .eq('id', conversationId)
      .maybeSingle()
    const conversation = data as unknown as ConversationRow | null

    if (!conversation) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const other = conversation.renter_id === user.id ? conversation.host : conversation.renter
    if (!other) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setHeader({
      conversationId: conversation.id,
      bookingId: conversation.booking_id,
      bookingRef: conversation.booking?.booking_ref ?? null,
      listingId: conversation.listing_id,
      listingTitle: conversation.listing?.title ?? 'Rentivo listing',
      otherUser: other,
    })

    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    setMessages(msgs ?? [])
    setLoading(false)

    const unreadIds = (msgs ?? []).filter((m) => m.sender_id !== user.id && !m.is_read).map((m) => m.id)
    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ is_read: true }).in('id', unreadIds)
    }
  }, [conversationId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    load()
  }, [load])

  useEffect(() => {
    if (!conversationId || !isSupabaseConfigured()) return
    const supabase = createClient()
    const channel = supabase
      .channel(`conversation:${conversationId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
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
  }, [conversationId, userId])

  async function send(content: string, imageFile?: File): Promise<string | null> {
    if (!conversationId || !userId) return null
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
      .insert({ conversation_id: conversationId, sender_id: userId, content: content.trim(), image_url: imageUrl })
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
