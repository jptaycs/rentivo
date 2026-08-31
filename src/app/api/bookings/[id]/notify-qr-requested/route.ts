import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyHostQrBookingRequested } from '@/lib/email'

/**
 * Fired by the client right after it creates a host_qr booking (create_booking
 * RPC already governs that insert). This route only handles the email
 * side-effect, which needs the admin client + RESEND_API_KEY that can't run
 * client-side — same shape as /api/messages/notify.
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
    .select('renter_id, payment_method')
    .eq('id', id)
    .maybeSingle()
  if (!booking || booking.renter_id !== user.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  if (booking.payment_method !== 'host_qr') {
    return NextResponse.json({ error: 'This booking is not paid via QR.' }, { status: 400 })
  }

  notifyHostQrBookingRequested(id).catch((e) => console.error('[email] notifyHostQrBookingRequested failed', e))

  return NextResponse.json({ ok: true })
}
