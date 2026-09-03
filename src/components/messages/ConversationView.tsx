'use client'

import { useRef, useState, useEffect, useMemo } from 'react'
import { Send, ArrowLeft, CalendarDays, ImagePlus, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import Link from 'next/link'
import type { ConversationHeader } from '@/hooks/useConversation'
import type { Message } from '@/types'

const IMAGE_URL_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/message-images/`

interface ConversationViewProps {
  header: ConversationHeader
  messages: Message[]
  currentUserId: string | null
  onSend: (text: string, imageFile?: File) => Promise<string | null>
  onBack?: () => void
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function ConversationView({ header, messages, currentUserId, onSend, onBack }: ConversationViewProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeConversationId = useRef(header.conversationId)
  const previewUrl = useMemo(
    () => (pendingImage ? URL.createObjectURL(pendingImage) : null),
    [pendingImage]
  )
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    activeConversationId.current = header.conversationId
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset composer state on thread change; no test suite to safely verify a rewrite (see AGENTS.md)
    setInput('')
    setError('')
    setPendingImage(null)
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [header.conversationId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages.length])

  async function send() {
    const text = input.trim()
    const image = pendingImage
    if ((!text && !image) || sending) return
    const sentFrom = header.conversationId
    setSending(true)
    setError('')
    setInput('')
    setPendingImage(null)
    const err = await onSend(text, image ?? undefined)
    if (err && activeConversationId.current === sentFrom) {
      setError(err)
      setInput(text)
      setPendingImage(image)
    }
    setSending(false)
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
        <Avatar className="w-9 h-9 shrink-0">
          <AvatarImage src={header.otherUser.avatar_url ?? ''} alt={header.otherUser.full_name} />
          <AvatarFallback className="bg-[#003049]/10 font-bold text-[#003049] text-sm">
            {header.otherUser.full_name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#111827] text-sm">{header.otherUser.full_name}</p>
          <p className="text-xs text-gray-400 truncate">
            {header.bookingRef ? `${header.listingTitle} · ${header.bookingRef}` : header.listingTitle}
          </p>
        </div>
        {header.bookingId ? (
          <Link
            href="/dashboard/bookings"
            className="flex items-center gap-1.5 text-xs font-medium text-[#003049] border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Booking
          </Link>
        ) : (
          <Link
            href={`/listings/${header.listingId}`}
            className="flex items-center gap-1.5 text-xs font-medium text-[#003049] border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            View listing
          </Link>
        )}
      </div>

      {/* Booking context pill */}
      <div className="px-4 py-2.5 bg-blue-50/60 border-b border-blue-100/60 shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#003049] font-semibold">{header.listingTitle}</p>
          {header.bookingRef && <span className="text-xs text-gray-400">{header.bookingRef}</span>}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            No messages yet — say hello about {header.listingTitle}.
          </p>
        ) : (
          <>
            <p className="text-center text-[11px] text-gray-400 font-medium">
              {formatDay(messages[0].created_at)}
            </p>
            {messages.map((msg) => {
              const isMe = msg.sender_id === currentUserId
              const imageUrl = msg.image_url?.startsWith(IMAGE_URL_PREFIX) ? msg.image_url : null
              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[75%] group">
                    <div className={`rounded-2xl text-sm leading-relaxed overflow-hidden ${
                      isMe
                        ? 'bg-[#003049] text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-[#111827] rounded-bl-sm shadow-sm'
                    }`}>
                      {imageUrl && (
                        <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageUrl}
                            alt="Attached photo"
                            loading="lazy"
                            className="max-h-64 w-full object-cover"
                          />
                        </a>
                      )}
                      {msg.content && <div className="px-4 py-2.5">{msg.content}</div>}
                    </div>
                    <p className={`text-[10px] text-gray-400 mt-1 ${isMe ? 'text-right' : ''}`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white shrink-0">
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        {previewUrl && (
          <div className="mb-2 inline-flex items-start gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Attachment preview" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
            <button
              onClick={() => setPendingImage(null)}
              className="w-5 h-5 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
              aria-label="Remove attachment"
            >
              <X className="w-3 h-3 text-gray-500" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 bg-[#F8FAFC] border border-gray-200 rounded-2xl px-4 py-2.5 focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setPendingImage(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-400 hover:text-[#003049] transition-colors shrink-0"
            aria-label="Attach an image"
          >
            <ImagePlus className="w-4.5 h-4.5" />
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            maxLength={4000}
            placeholder="Type a message…"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
          />
          <button
            onClick={send}
            disabled={(!input.trim() && !pendingImage) || sending}
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
