'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { MOCK_THREADS } from '@/lib/mock-messages'
import { ThreadList } from '@/components/messages/ThreadList'
import { ConversationView } from '@/components/messages/ConversationView'

export default function MessagesPage() {
  const [activeId, setActiveId] = useState<string | null>(MOCK_THREADS[0].id)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  const active = MOCK_THREADS.find(t => t.id === activeId) ?? null

  function handleSelect(id: string) {
    setActiveId(id)
    setMobileView('chat')
  }

  return (
    <div className="h-full flex">
      {/* Thread list — desktop always visible; mobile only when mobileView=list */}
      <div className={`w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white shrink-0 flex flex-col ${mobileView === 'chat' ? 'hidden md:flex' : 'flex'}`}>
        <ThreadList
          threads={MOCK_THREADS}
          activeId={activeId}
          onSelect={handleSelect}
        />
      </div>

      {/* Conversation panel */}
      <div className={`flex-1 bg-[#F8FAFC] flex flex-col min-w-0 ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {active ? (
          <ConversationView
            thread={active}
            onBack={() => setMobileView('list')}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-7 h-7 text-gray-300" />
            </div>
            <p className="font-bold text-[#111827]">Select a conversation</p>
            <p className="text-sm text-gray-400 mt-1">Choose a thread from the left to start messaging</p>
          </div>
        )}
      </div>
    </div>
  )
}
