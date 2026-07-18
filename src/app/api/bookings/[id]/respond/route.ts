import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyBookingResponded } from '@/lib/email'
import { refundBooking } from '@/lib/refunds'

/**
 * Host accept/decline of a pending booking, or renter cancellation of
 * their own pending booking — RLS + the enforce_booking_transition
 * trigger decide who's actually allowed to make which transition here.
 * Wraps the same update the client used to do directly, adding a
 * server-side refund + email notification once it succeeds.
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

  if (body.status === 'cancelled') {
    const cancelledBy = user.id === data.renter_id ? 'renter' : 'host'
    const { refunded, error: refundError } = await refundBooking(id)
    if (refundError) console.error('[refund] booking', id, refundError)
    notifyBookingResponded(id, 'cancelled', cancelledBy, refunded).catch((e) =>
      console.error('[email] notifyBookingResponded failed', e)
    )
  } else {
    notifyBookingResponded(id, 'confirmed').catch((e) => console.error('[email] notifyBookingResponded failed', e))
  }

  return NextResponse.json({ booking: data })
}
