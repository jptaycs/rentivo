import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyBookingPaid } from '@/lib/email'

/**
 * Fired by the client right after the host marks a host_qr booking's
 * payment received (confirm_host_qr_payment RPC already governs that
 * update). Reuses notifyBookingPaid as-is — it's payment-method-agnostic,
 * loading whatever the booking's current state is rather than assuming
 * PayMongo. This route only handles the email side-effect.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('host_id, payment_method, payment_status')
    .eq('id', id)
    .maybeSingle()
  if (!booking || booking.host_id !== user.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  if (booking.payment_method !== 'host_qr' || booking.payment_status !== 'paid') {
    return NextResponse.json({ error: 'Booking is not a confirmed QR payment.' }, { status: 400 })
  }

  notifyBookingPaid(id).catch((e) => console.error('[email] notifyBookingPaid (QR) failed', e))

  return NextResponse.json({ ok: true })
}
