import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPayMongoConfigured, getPaymentIntent } from '@/lib/paymongo'
import { notifyBookingPaid } from '@/lib/email'

/**
 * On-demand payment verification for a booking the renter believes they've
 * already paid.
 *
 * QR Ph has no redirect back to the app (the customer scans with a separate
 * banking/e-wallet app and stays on our page), so unlike GCash/Maya/card there
 * is no `/book/complete` pass to fall back on — the `payment.paid` webhook is
 * otherwise the ONLY thing that can flip payment_status. If that webhook is
 * delayed or missed, a renter who really did pay is stranded on the polling
 * spinner with no way out. This route is that way out: it asks PayMongo
 * directly about the intent and marks the booking paid if the money is in.
 *
 * Same verification logic as `/book/complete`, scoped to the booking's own
 * renter. Safe to call repeatedly — mark_booking_paid is idempotent, and a
 * still-unpaid intent just reports back as not-yet-paid.
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

  // Scoped to the renter on the booking — RLS governs this read too, the
  // explicit filter just makes someone else's booking a clean 404.
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, renter_id, payment_status, paymongo_ref')
    .eq('id', id)
    .eq('renter_id', user.id)
    .maybeSingle()
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
  }

  if (booking.payment_status === 'paid') {
    return NextResponse.json({ status: 'paid' })
  }
  if (!booking.paymongo_ref || !isPayMongoConfigured()) {
    return NextResponse.json({ status: 'unpaid' })
  }

  try {
    const intent = await getPaymentIntent(booking.paymongo_ref)
    const intentStatus = intent.attributes.status

    if (intentStatus === 'succeeded') {
      const admin = createAdminClient()
      const { data: paid, error } = await admin.rpc('mark_booking_paid', {
        p_booking_id: booking.id,
        p_paymongo_ref: booking.paymongo_ref,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      // Guarded the same way as every other mark-paid caller: only fires on
      // the real unpaid→paid transition, so a repeated check can't re-notify.
      if (paid) {
        notifyBookingPaid(booking.id).catch((e) =>
          console.error('[email] notifyBookingPaid failed', e)
        )
      }
      return NextResponse.json({ status: 'paid' })
    }

    if (intentStatus === 'processing') {
      return NextResponse.json({ status: 'processing' })
    }
    return NextResponse.json({ status: 'unpaid' })
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach PayMongo to check this payment. Please try again." },
      { status: 502 }
    )
  }
}
