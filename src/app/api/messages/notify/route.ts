import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyNewMessage } from '@/lib/email'

/**
 * Fired by the client right after it inserts a message (RLS already
 * governs that insert). This route only handles the email side-effect,
 * which needs the admin client + RESEND_API_KEY that can't run client-side.
 */
export async function POST(req: Request) {
  let body: { messageId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.messageId) {
    return NextResponse.json({ error: 'messageId is required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const { data: message } = await supabase
    .from('messages')
    .select('sender_id')
    .eq('id', body.messageId)
    .maybeSingle()
  if (!message || message.sender_id !== user.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  notifyNewMessage(body.messageId).catch((e) => console.error('[email] notifyNewMessage failed', e))

  return NextResponse.json({ ok: true })
}
