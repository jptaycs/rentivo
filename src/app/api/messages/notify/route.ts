import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyNewMessage } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Fired by the client right after it inserts a message (RLS already
 * governs that insert). This route only handles the email side-effect,
 * which needs the admin client + RESEND_API_KEY that can't run client-side.
 *
 * Each message's email goes out AT MOST ONCE (076). Before, nothing recorded
 * a send, so posting one message and then calling this route in a loop made
 * Rentivo email the other party on every call — an email bomb from
 * noreply@rentivo.live. The route now claims messages.notified_at atomically
 * with the service role and sends only if the claim matched a row.
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

  // Sender check first: only the message's own sender may trigger its email.
  const { data: message } = await supabase
    .from('messages')
    .select('sender_id')
    .eq('id', body.messageId)
    .maybeSingle()
  if (!message || message.sender_id !== user.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  // Fails open on a limiter error — see src/lib/rate-limit.ts. The notified_at
  // claim below still caps this route at one email per message regardless.
  const limited = await rateLimit('notify', user.id)
  if (limited) return limited

  // Atomic once-only claim. Service role: clients hold UPDATE on messages.is_read
  // only (053), and must never be able to reset this column.
  const admin = createAdminClient()
  const { data: claimed, error: claimError } = await admin
    .from('messages')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', body.messageId)
    .is('notified_at', null)
    .select('id')
  if (claimError) {
    console.error('[email] notified_at claim failed', claimError.message)
    return NextResponse.json({ error: 'Could not send the notification.' }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    // Already notified — idempotent success, no email.
    return NextResponse.json({ ok: true, alreadyNotified: true })
  }

  notifyNewMessage(body.messageId).catch((e) => console.error('[email] notifyNewMessage failed', e))

  return NextResponse.json({ ok: true })
}
