import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isPayMongoConfigured,
  createPaymentIntent,
  createEwalletPaymentMethod,
  createQrPhPaymentMethod,
  attachPaymentIntent,
  paymentErrorMessage,
  isMethodNotActivatedError,
} from '@/lib/paymongo'
import { isPaymentMethodDisabled, unavailableMethodMessage } from '@/lib/payment-methods'
import { notifyBookingPaid } from '@/lib/email'
import type { Booking } from '@/types'

interface CheckoutBody {
  listingId?: string
  pickupDate?: string
  returnDate?: string
  isDelivery?: boolean
  deliveryAddress?: string | null
  method?: 'gcash' | 'maya' | 'card' | 'qrph' | 'apple_pay' | 'google_pay'
  phone?: string | null
  promoCode?: string | null
  /** Card payment method created in the browser with the public key */
  paymentMethodId?: string | null
  /** Reuse an unpaid booking from a previous failed attempt */
  bookingId?: string | null
}

const CHARGEABLE = { gcash: 'gcash', maya: 'paymaya', card: 'card', qrph: 'qrph' } as const

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to book.' }, { status: 401 })
  }

  let body: CheckoutBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (!body.method || !(body.method in CHARGEABLE)) {
    return NextResponse.json(
      { error: 'This payment method is not available yet. Please choose GCash, Maya, Card, or QR Ph.' },
      { status: 400 }
    )
  }

  // Methods PayMongo hasn't activated for this account yet (KYB pending).
  // Step3Payment hides these tiles, but the server is the gate: reject here,
  // by name, BEFORE a booking row exists — otherwise PayMongo rejects the
  // attach later and the renter sees a generic "Payment failed" plus an
  // orphaned unpaid booking.
  if (isPaymentMethodDisabled(body.method)) {
    return NextResponse.json({ error: unavailableMethodMessage(body.method) }, { status: 400 })
  }

  // ── 1. Create the booking (or reuse the one from a failed attempt) ──
  let booking: Booking
  if (body.bookingId) {
    // Never reuse a host_qr booking for a PayMongo charge: the row's
    // payment_method would stay 'host_qr', which request_payout() excludes from
    // payout eligibility — Rentivo would take real money it could never pay out
    // to the host. Such a booking simply isn't found here, and falls into the
    // existing "Booking not found or already paid." response below.
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', body.bookingId)
      .eq('renter_id', user.id)
      .eq('payment_status', 'unpaid')
      .eq('status', 'pending')
      .neq('payment_method', 'host_qr')
      .single()
    if (error || !data) {
      return NextResponse.json({ error: 'Booking not found or already paid.' }, { status: 400 })
    }
    // A booking made before the host was suspended is still sitting here unpaid.
    // create_booking's suspension guard (045) only covers the branch below that
    // creates a new row, so without this check the reuse path would take real
    // money for a host who is off the marketplace. is_host_suspended is
    // `security definer` (046), so this answer does not depend on what the
    // renter's session is allowed to read from `profiles`. The message matches
    // the not-found response above on purpose — a renter has no business
    // learning the moderation state of a stranger's account.
    const { data: suspended, error: suspendedError } = await supabase.rpc('is_host_suspended', {
      p_host_id: (data as Booking).host_id,
    })
    if (suspendedError || suspended) {
      return NextResponse.json({ error: 'Booking not found or already paid.' }, { status: 400 })
    }
    booking = data as Booking
  } else {
    if (!body.listingId || !body.pickupDate || !body.returnDate) {
      return NextResponse.json({ error: 'Missing booking details.' }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('create_booking', {
      p_listing_id: body.listingId,
      p_pickup_date: body.pickupDate,
      p_return_date: body.returnDate,
      p_is_delivery: body.isDelivery ?? false,
      p_delivery_address: body.isDelivery ? body.deliveryAddress : null,
      p_payment_method: body.method,
      p_promo_code: body.promoCode || null,
    })
    if (error) {
      return NextResponse.json(
        { error: error.message.replace(/^.*?: /, '') },
        { status: 400 }
      )
    }
    booking = data as Booking
  }

  // NOTE: the pre-launch 'test_skip' branch that marked a booking paid with no
  // real charge was removed at launch. Rejecting it in the method validation
  // above is the load-bearing part — dropping only the checkout tile would have
  // left the free-booking path fully reachable by a crafted request.

  // ── 2. No PayMongo keys → simulated payment (development only) ──
  if (!isPayMongoConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Payments are not configured.', bookingId: booking.id },
        { status: 503 }
      )
    }
    try {
      const admin = createAdminClient()
      const { data: paid, error } = await admin.rpc('mark_booking_paid', {
        p_booking_id: booking.id,
        p_paymongo_ref: 'pi_simulated_dev',
      })
      if (error) throw new Error(error.message)
      notifyBookingPaid(booking.id).catch((e) => console.error('[email] notifyBookingPaid failed', e))
      return NextResponse.json({ status: 'paid', simulated: true, booking: paid })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment simulation failed.'
      return NextResponse.json({ error: message, bookingId: booking.id }, { status: 500 })
    }
  }

  // ── 3. Charge through PayMongo ──
  try {
    const admin = createAdminClient()

    const intent = await createPaymentIntent({
      amountCentavos: booking.total_amount * 100,
      description: `Rentivo ${booking.booking_ref} — equipment rental`,
      metadata: { booking_id: booking.id, booking_ref: booking.booking_ref },
    })

    await admin.from('bookings').update({ paymongo_ref: intent.id }).eq('id', booking.id)

    let paymentMethodId = body.paymentMethodId
    if (body.method === 'card') {
      if (!paymentMethodId) {
        return NextResponse.json(
          { error: 'Card could not be processed. Please re-enter your details.', bookingId: booking.id },
          { status: 400 }
        )
      }
    } else if (body.method === 'qrph') {
      // No billing data needed — the customer scans with whichever
      // QR Ph-participating bank/e-wallet app they already have.
      const pm = await createQrPhPaymentMethod()
      paymentMethodId = pm.id
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      const pm = await createEwalletPaymentMethod({
        type: CHARGEABLE[body.method as 'gcash' | 'maya'] as 'gcash' | 'paymaya',
        name: profile?.full_name || user.email || 'Rentivo renter',
        email: user.email,
        phone: body.phone || undefined,
      })
      paymentMethodId = pm.id
    }

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/book/complete?booking=${booking.id}`
    const attached = await attachPaymentIntent(intent.id, paymentMethodId, returnUrl)

    switch (attached.attributes.status) {
      case 'succeeded': {
        const { data: paid, error } = await admin.rpc('mark_booking_paid', {
          p_booking_id: booking.id,
          p_paymongo_ref: intent.id,
        })
        if (error) {
          // Charge went through; webhook / return page will reconcile
          return NextResponse.json({ status: 'redirect', url: returnUrl, bookingId: booking.id })
        }
        notifyBookingPaid(booking.id).catch((e) => console.error('[email] notifyBookingPaid failed', e))
        return NextResponse.json({ status: 'paid', booking: paid })
      }
      case 'awaiting_next_action': {
        const nextAction = attached.attributes.next_action
        // QR Ph never redirects the browser — it returns a QR image to
        // display inline, and the customer scans it with a separate app.
        // Everything else (GCash/Maya wallet auth, card 3DS) redirects.
        if (nextAction && 'code' in nextAction) {
          return NextResponse.json({
            status: 'qr',
            qrImage: nextAction.code.image_url,
            bookingId: booking.id,
          })
        }
        return NextResponse.json({
          status: 'redirect',
          url: nextAction && 'redirect' in nextAction ? nextAction.redirect.url : returnUrl,
          bookingId: booking.id,
        })
      }
      case 'processing':
        return NextResponse.json({ status: 'redirect', url: returnUrl, bookingId: booking.id })
      default:
        return NextResponse.json(
          { error: paymentErrorMessage(attached), bookingId: booking.id },
          { status: 402 }
        )
    }
  } catch (err) {
    // The env list above can lag PayMongo's actual account state (it's
    // maintained by hand). If PayMongo itself says the method isn't activated,
    // still surface the specific message rather than its raw error text.
    if (isMethodNotActivatedError(err)) {
      console.warn('[checkout] PayMongo rejected inactive method', body.method, err.message)
      return NextResponse.json(
        { error: unavailableMethodMessage(body.method), bookingId: booking.id },
        { status: 400 }
      )
    }
    const message = err instanceof Error ? err.message : 'Payment failed. Please try again.'
    return NextResponse.json({ error: message, bookingId: booking.id }, { status: 502 })
  }
}
