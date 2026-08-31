import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Signed-URL route for a booking's host-QR payment image. Scoped to
 * exactly the two parties on the booking (renter + host) — storage RLS
 * alone can't express "any renter with an active booking against this
 * host", so this uses the service-role client to look up the host's QR
 * path and mint a short-lived signed URL after checking party membership
 * with the auth-aware client.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select('renter_id, host_id, payment_method')
    .eq('id', id)
    .maybeSingle()
  if (!booking || (booking.renter_id !== user.id && booking.host_id !== user.id)) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
  }
  if (booking.payment_method !== 'host_qr') {
    return NextResponse.json({ error: 'This booking is not paid via QR.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: hostProfile } = await admin
    .from('profiles')
    .select('qr_payment_url, qr_payment_label')
    .eq('id', booking.host_id)
    .maybeSingle()
  if (!hostProfile?.qr_payment_url) {
    return NextResponse.json({ error: 'Host has not uploaded a QR code.' }, { status: 404 })
  }

  const { data: signed, error } = await admin.storage
    .from('payment-qr-codes')
    .createSignedUrl(hostProfile.qr_payment_url, 300)
  if (error || !signed) {
    return NextResponse.json({ error: 'Could not load the QR image.' }, { status: 500 })
  }

  // The label ("GCash — Juan Dela Cruz, 09XX XXX XXXX") is host name + phone,
  // so it's served only here, in the same party-scoped context as the QR image
  // itself — it's deliberately excluded from PROFILE_COLUMNS (listing-columns.ts)
  // so it can never reach a public listing/search/host-profile payload.
  return NextResponse.json({ url: signed.signedUrl, label: hostProfile.qr_payment_label ?? null })
}
