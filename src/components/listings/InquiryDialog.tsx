'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface InquiryDialogProps {
  listingId: string
  hostName: string
  open: boolean
  onClose: () => void
}

// Best-effort: read back the message create_inquiry just inserted and fire
// the same email-notify side effect useConversation.send() fires for every
// later reply. Never throws — a notification failure must never surface to
// the user, who has already successfully sent their message by this point.
async function notifyInquiryOpened(supabase: SupabaseClient, conversationId: string) {
  try {
    const { data: message } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!message) return
    await fetch('/api/messages/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: message.id }),
    })
  } catch {
    // best-effort only
  }
}

export function InquiryDialog({ listingId, hostName, open, onClose }: InquiryDialogProps) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Resolve auth as soon as the dialog opens, not after the user has typed a
  // message and pressed Send — listing pages are public, so signed-out is
  // the most common state here, and it previously discarded typed text.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || user) return
      router.push(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`)
    })
    return () => {
      cancelled = true
    }
  }, [open, listingId, router])

  if (!open) return null

  async function send() {
    if (!content.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`)
        return
      }
      const { data, error: rpcError } = await supabase.rpc('create_inquiry', {
        p_listing_id: listingId,
        p_content: content.trim(),
      })
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      // Fire-and-forget, exactly like useConversation.send() — don't make
      // the user wait on an email, and never let it block navigation.
      notifyInquiryOpened(supabase, data).catch(() => {})
      router.push(`/dashboard/messages?view=renter&conversation=${data}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-[#111827]">Message {hostName}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Ask about availability, condition, or pickup before you book.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Hi! Is this available next weekend?"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#003049] resize-none"
        />

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <button
          type="button"
          onClick={send}
          disabled={!content.trim() || sending}
          className="w-full mt-4 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {sending && <Loader2 className="w-4 h-4 animate-spin" />}
          {sending ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </div>
  )
}
