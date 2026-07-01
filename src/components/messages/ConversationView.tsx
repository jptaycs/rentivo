'use client'

import { useRef, useState, useEffect } from 'react'
import { Send, Image as ImageIcon, ArrowLeft, CalendarDays, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { Thread } from '@/lib/mock-messages'

interface ConversationViewProps {
  thread: Thread
  onBack?: () => void
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function ConversationView({ thread, onBack }: ConversationViewProps) {
  const [messages, setMessages] = useState(thread.messages)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(thread.messages)
    setInput('')
    // instant jump to bottom when switching threads
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [thread.id])

  useEffect(() => {
    // smooth scroll only when a new message is appended
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  function send() {
    const text = input.trim()
    if (!text) return
    setMessages(prev => [
      ...prev,
      { id: `local-${Date.now()}`, senderId: 'me', text, at: new Date().toISOString() },
    ])
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-white shrink-0">
        {onBack && (
          <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
        )}
        <div className="w-9 h-9 rounded-full bg-[#003049]/10 flex items-center justify-center font-bold text-[#003049] text-sm shrink-0">
          {thread.otherUser.initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#111827] text-sm">{thread.otherUser.name}</p>
          <p className="text-xs text-gray-400 truncate">{thread.equipment} · {thread.bookingRef}</p>
        </div>
        <Link
          href="/dashboard/bookings"
          className="flex items-center gap-1.5 text-xs font-medium text-[#003049] border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
        >
          <CalendarDays className="w-3.5 h-3.5" />
          Booking
        </Link>
      </div>

      {/* Booking context pill */}
      <div className="px-4 py-2.5 bg-blue-50/60 border-b border-blue-100/60 shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#003049] font-semibold">{thread.equipment}</p>
          <span className="text-xs text-gray-400">{thread.bookingRef}</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-center text-[11px] text-gray-400 font-medium">
          {formatDay(messages[0]?.at ?? new Date().toISOString())}
        </p>

        {messages.map((msg) => {
          const isMe = msg.senderId === 'me'
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] group`}>
                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  isMe
                    ? 'bg-[#003049] text-white rounded-br-sm'
                    : 'bg-white border border-gray-200 text-[#111827] rounded-bl-sm shadow-sm'
                }`}>
                  {msg.text}
                </div>
                <p className={`text-[10px] text-gray-400 mt-1 ${isMe ? 'text-right' : ''}`}>
                  {formatTime(msg.at)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white shrink-0">
        <div className="flex items-center gap-2 bg-[#F8FAFC] border border-gray-200 rounded-2xl px-4 py-2.5 focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <button className="text-gray-400 hover:text-[#003049] transition-colors shrink-0">
            <ImageIcon className="w-4 h-4" />
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message…"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="w-8 h-8 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 text-white rounded-xl flex items-center justify-center transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 text-center mt-2">
          Keep all communication and payments within Rentivo for your protection.
        </p>
      </div>
    </div>
  )
}
