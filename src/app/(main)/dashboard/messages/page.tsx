'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageSquare, Loader2 } from 'lucide-react'
import { MOCK_THREADS } from '@/lib/mock-messages'
import { useThreads } from '@/hooks/useThreads'
import { useConversation } from '@/hooks/useConversation'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { ThreadList } from '@/components/messages/ThreadList'
import { ConversationView } from '@/components/messages/ConversationView'

function MockConversationView({ thread, onBack }: { thread: (typeof MOCK_THREADS)[0]; onBack: () => void }) {
  const header = {
    bookingId: thread.id,
    bookingRef: thread.bookingRef,
    listingTitle: thread.equipment,
    otherUser: { id: 'them', full_name: thread.otherUser.name, avatar_url: null },
  }
  const messages = thread.messages.map((m) => ({
    id: m.id,
    booking_id: thread.id,
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

  useEffect(() => {
    const fromQuery = searchParams.get('booking')
    if (fromQuery) {
      setActiveId(fromQuery)
      setMobileView('chat')
    } else if (!live && !activeId) {
      setActiveId(MOCK_THREADS[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, live])

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
              bookingId: t.id,
              bookingRef: t.bookingRef,
              listingTitle: t.equipment,
              otherUser: { id: 'them', full_name: t.otherUser.name, avatar_url: null },
              lastMessage: t.lastMessage,
              lastAt: t.lastAt,
              unreadCount: t.unread,
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
