'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, Loader2 } from 'lucide-react'
import { MOCK_THREADS } from '@/lib/mock-messages'
import { useThreads } from '@/hooks/useThreads'
import { useConversation } from '@/hooks/useConversation'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { createClient } from '@/lib/supabase/client'
import { ThreadList } from '@/components/messages/ThreadList'
import { ConversationView } from '@/components/messages/ConversationView'

function MockConversationView({ thread, onBack }: { thread: (typeof MOCK_THREADS)[0]; onBack: () => void }) {
  const header = {
    conversationId: thread.id,
    bookingId: thread.id,
    bookingRef: thread.bookingRef,
    listingId: thread.id,
    listingTitle: thread.equipment,
    otherUser: { id: 'them', full_name: thread.otherUser.name, avatar_url: null },
  }
  const messages = thread.messages.map((m) => ({
    id: m.id,
    conversation_id: thread.id,
    sender_id: m.senderId === 'me' ? 'me' : 'them',
    content: m.text,
    image_url: null,
    is_read: true,
    created_at: m.at,
  }))
  return (
    <ConversationView
      header={header}
      messages={messages}
      currentUserId="me"
      onSend={async () => null}
      onBack={onBack}
    />
  )
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 text-gray-300 animate-spin" /></div>}>
      <MessagesPageInner />
    </Suspense>
  )
}

function MessagesPageInner() {
  const live = isSupabaseConfigured()
  const searchParams = useSearchParams()
  const { threads, loading: threadsLoading } = useThreads()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  // Tracks the last `?conversation=`/`?booking=` param we actually resolved
  // into an activeId. useThreads() subscribes to every message INSERT and
  // reloads, which changes `threads`' identity on unrelated activity — without
  // this guard, this effect (which depends on `threads` so it can resolve a
  // deep link once threads finish loading) would re-fire on every such reload
  // and yank the user back to the deep-linked thread even after they'd
  // manually switched away and started typing elsewhere.
  const resolvedParamRef = useRef<string | null>(null)

  useEffect(() => {
    const conversationParam = searchParams.get('conversation')
    const bookingParam = searchParams.get('booking')
    const paramKey = conversationParam ? `c:${conversationParam}` : bookingParam ? `b:${bookingParam}` : null

    if (paramKey && paramKey === resolvedParamRef.current) return

    if (conversationParam) {
      resolvedParamRef.current = paramKey
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selected thread to URL param; no test suite to safely verify a rewrite (see AGENTS.md)
      setActiveId(conversationParam)
      setMobileView('chat')
      return
    }
    if (bookingParam) {
      const match = threads.find((t) => t.bookingId === bookingParam)
      if (match) {
        resolvedParamRef.current = paramKey
        setActiveId(match.conversationId)
        setMobileView('chat')
        return
      }
      // Every booking gets a conversation at insert time (migrations 052/055),
      // but useThreads() deliberately drops booking threads with zero
      // messages — so a fresh booking's conversation (the common case right
      // after a booking is made, before either party has said anything) won't
      // be in `threads` yet. Resolve it directly instead of leaving the deep
      // link dead. Do NOT "fix" this by dropping the zero-message filter in
      // useThreads — that would surface empty booking threads to every user.
      if (!live) return
      let cancelled = false
      ;(async () => {
        const supabase = createClient()
        const { data } = await supabase
          .from('conversations')
          .select('id')
          .eq('booking_id', bookingParam)
          .maybeSingle()
        if (!cancelled && data) {
          resolvedParamRef.current = paramKey
          setActiveId(data.id)
          setMobileView('chat')
        }
      })()
      return () => {
        cancelled = true
      }
    }
    if (!live && !activeId) {
      setActiveId(MOCK_THREADS[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, live, threads])

  const conversation = useConversation(live ? activeId : null)

  function handleSelect(id: string) {
    setActiveId(id)
    setMobileView('chat')
  }

  const mockActive = !live ? MOCK_THREADS.find((t) => t.id === activeId) ?? null : null

  return (
    <div className="h-full flex">
      {/* Thread list */}
      <div className={`w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white shrink-0 flex flex-col ${mobileView === 'chat' ? 'hidden md:flex' : 'flex'}`}>
        {live && threadsLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
          </div>
        ) : (
          <ThreadList
            threads={live ? threads : MOCK_THREADS.map((t) => ({
              conversationId: t.id,
              bookingId: t.id,
              bookingRef: t.bookingRef,
              listingId: t.id,
              listingTitle: t.equipment,
              otherUser: { id: 'them', full_name: t.otherUser.name, avatar_url: null },
              lastMessage: t.lastMessage,
              lastAt: t.lastAt,
              unreadCount: t.unread,
              isInquiry: false,
            }))}
            activeId={activeId}
            onSelect={handleSelect}
          />
        )}
      </div>

      {/* Conversation panel */}
      <div className={`flex-1 bg-[#F8FAFC] flex flex-col min-w-0 ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {!live ? (
          mockActive ? (
            <MockConversationView thread={mockActive} onBack={() => setMobileView('list')} />
          ) : (
            <EmptyState />
          )
        ) : !activeId ? (
          <EmptyState />
        ) : conversation.loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
          </div>
        ) : conversation.notFound || !conversation.header ? (
          <EmptyState message="Conversation not found." />
        ) : (
          <ConversationView
            header={conversation.header}
            messages={conversation.messages}
            currentUserId={conversation.userId}
            onSend={conversation.send}
            onBack={() => setMobileView('list')}
          />
        )}
      </div>
    </div>
  )
}

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <MessageSquare className="w-7 h-7 text-gray-300" />
      </div>
      <p className="font-bold text-[#111827]">{message ?? 'Select a conversation'}</p>
      {!message && <p className="text-sm text-gray-400 mt-1">Choose a thread from the left to start messaging</p>}
    </div>
  )
}
