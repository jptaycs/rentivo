import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyBookingResponded } from '@/lib/email'

/**
 * Host accept/decline for a pending booking. Wraps the same RLS-scoped
 * update the client used to do directly, adding a server-side email
 * notification to the renter once the transition succeeds.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { status?: 'confirmed' | 'cancelled' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.status !== 'confirmed' && body.status !== 'cancelled') {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({ status: body.status })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message.replace(/^.*?: /, '') }, { status: 400 })
  }

  notifyBookingResponded(id, body.status).catch((e) => console.error('[email] notifyBookingResponded failed', e))

  return NextResponse.json({ booking: data })
}
