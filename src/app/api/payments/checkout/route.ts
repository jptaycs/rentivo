import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
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
import { canReuseBooking, isInPhilippines, OUTSIDE_PH_MESSAGE, roundPinCoord } from '@/lib/delivery-location'
import { storedBookingAmounts } from '@/lib/pricing'
import type { Booking } from '@/types'

interface CheckoutBody {
  listingId?: string
  pickupDate?: string
  returnDate?: string
  isDelivery?: boolean
  deliveryAddress?: string | null
  method?: 'gcash' | 'maya' | 'card' | 'qrph' | 'apple_pay' | 'google_pay'
  phone?: string | null
  /** Card payment method created in the browser with the public key */
  paymentMethodId?: string | null
  /** Reuse an unpaid booking from a previous failed attempt */
  bookingId?: string | null
  /** 078: the renter's delivery pin. Only forwarded to create_booking for delivery. */
  deliveryLat?: number | null
  deliveryLng?: number | null
  /**
   * The total the renter was SHOWN. Never used to price anything — the intent is
   * priced from the stored total_amount. It only lets the route stop before
   * charging when the stored total differs (a host changed a rate between the
   * quote and the booking), so the renter sees the stored figure before paying.
   */
  expectedTotal?: number | null
}

function isAbsent(v: unknown) {
  return v === undefined || v === null
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

  // 10 per 10 minutes: every call can create a PayMongo payment intent (and a
  // booking). Counted before body validation so malformed attempts count too.
  // Fails open on a limiter error — deliberate, see src/lib/rate-limit.ts; the
  // bookings trigger (076, 10/hour per renter) still guards create_booking.
  const limited = await rateLimit('checkout', user.id)
  if (limited) return limited

  // A suspended CALLER must not be able to pay (security audit 2, LOW-1). This
  // is an API route, so the middleware's suspended_at check never runs here, and
  // a suspended renter's access token stays valid for up to an hour after the
  // ban. is_host_suspended() is a security-definer lookup of any profile's
  // suspended_at (046) — despite the name it answers for renters too. Fails
  // closed: this path moves real money, so "couldn't check" must not mean "ok".
  const { data: callerSuspended, error: callerSuspendedError } = await supabase.rpc('is_host_suspended', {
    p_host_id: user.id,
  })
  if (callerSuspendedError) {
    return NextResponse.json({ error: 'Could not verify your account. Please try again.' }, { status: 503 })
  }
  if (callerSuspended) {
    return NextResponse.json(
      { error: 'Your account is suspended. You cannot make payments — contact support.' },
      { status: 403 }
    )
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

  // 078: the delivery pin is either wholly absent or two finite numbers inside
  // the Philippines. A pin far outside the country would overflow
  // bookings.delivery_distance_km and fail inside create_booking with a raw
  // "numeric field overflow"; refuse it here with a sentence instead. No fee is
  // accepted from the client — create_booking computes it from the pin.
  const latAbsent = isAbsent(body.deliveryLat)
  const lngAbsent = isAbsent(body.deliveryLng)
  if (latAbsent !== lngAbsent) {
    return NextResponse.json({ error: 'Invalid delivery location.' }, { status: 400 })
  }
  let pin: { lat: number; lng: number } | null = null
  if (!latAbsent) {
    if (
      typeof body.deliveryLat !== 'number' || !Number.isFinite(body.deliveryLat) ||
      typeof body.deliveryLng !== 'number' || !Number.isFinite(body.deliveryLng)
    ) {
      return NextResponse.json({ error: 'Invalid delivery location.' }, { status: 400 })
    }
    if (!isInPhilippines(body.deliveryLat, body.deliveryLng)) {
      return NextResponse.json({ error: OUTSIDE_PH_MESSAGE }, { status: 400 })
    }
    pin = { lat: roundPinCoord(body.deliveryLat), lng: roundPinCoord(body.deliveryLng) }
  }
  const isDelivery = body.isDelivery === true
  if (!isAbsent(body.expectedTotal) && (typeof body.expectedTotal !== 'number' || !Number.isFinite(body.expectedTotal))) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // ── 1. Create the booking (or reuse the one from a failed attempt) ──
  let resolved: Booking | null = null
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
    // 078: reusing charges the STORED total, which was priced under the stored
    // pickup/delivery choice and pin. If the renter has since switched choice or
    // moved the pin, reusing would charge the old distance — so don't reuse;
    // fall through and create a freshly priced booking instead. Mirrors the
    // client's rule in BookingWizard (same canReuseBooking helper).
    if (canReuseBooking(data as Booking, isDelivery, pin)) {
      resolved = data as Booking
    }
  }
  if (!resolved) {
    if (!body.listingId || !body.pickupDate || !body.returnDate) {
      return NextResponse.json({ error: 'Missing booking details.' }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('create_booking', {
      p_listing_id: body.listingId,
      p_pickup_date: body.pickupDate,
      p_return_date: body.returnDate,
      p_is_delivery: isDelivery,
      p_delivery_address: isDelivery ? body.deliveryAddress : null,
      p_payment_method: body.method,
      p_promo_code: null,   // 071: promo codes discontinued
      p_delivery_lat: isDelivery ? (pin?.lat ?? null) : null,
      p_delivery_lng: isDelivery ? (pin?.lng ?? null) : null,
    })
    if (error) {
      return NextResponse.json(
        { error: error.message.replace(/^.*?: /, '') },
        { status: 400 }
      )
    }
    resolved = data as Booking
  }
  const booking: Booking = resolved
  const amounts = storedBookingAmounts(booking)

  // Ruling: once a booking exists, its STORED values win. If the stored total
  // differs from what the renter was shown (a host changed a rate between the
  // quote and the booking), stop before creating any payment intent and hand
  // back the stored figures. The wizard shows them and the renter pays again,
  // reusing this same booking — so they see the real total before paying.
  if (typeof body.expectedTotal === 'number' && body.expectedTotal !== booking.total_amount) {
    const deliveryNote = booking.is_delivery ? ` (delivery ₱${booking.delivery_fee.toLocaleString('en-PH')})` : ''
    return NextResponse.json(
      {
        error: `Your total is now ₱${booking.total_amount.toLocaleString('en-PH')}${deliveryNote}. The price changed since you reviewed it — please check the new total and pay again.`,
        code: 'total_changed',
        bookingId: booking.id,
        amounts,
      },
      { status: 409 }
    )
  }

  // NOTE: the pre-launch 'test_skip' branch that marked a booking paid with no
  // real charge was removed at launch. Rejecting it in the method validation
  // above is the load-bearing part — dropping only the checkout tile would have
  // left the free-booking path fully reachable by a crafted request.

  // ── 2. No PayMongo keys → simulated payment (development only) ──
  if (!isPayMongoConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Payments are not configured.', bookingId: booking.id, amounts },
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
      return NextResponse.json({ error: message, bookingId: booking.id, amounts }, { status: 500 })
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
          { error: 'Card could not be processed. Please re-enter your details.', bookingId: booking.id, amounts },
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
          return NextResponse.json({ status: 'redirect', url: returnUrl, bookingId: booking.id, amounts })
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
            amounts,
          })
        }
        return NextResponse.json({
          status: 'redirect',
          url: nextAction && 'redirect' in nextAction ? nextAction.redirect.url : returnUrl,
          bookingId: booking.id,
          amounts,
        })
      }
      case 'processing':
        return NextResponse.json({ status: 'redirect', url: returnUrl, bookingId: booking.id, amounts })
      default:
        return NextResponse.json(
          { error: paymentErrorMessage(attached), bookingId: booking.id, amounts },
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
        { error: unavailableMethodMessage(body.method), bookingId: booking.id, amounts },
        { status: 400 }
      )
    }
    const message = err instanceof Error ? err.message : 'Payment failed. Please try again.'
    return NextResponse.json({ error: message, bookingId: booking.id, amounts }, { status: 502 })
  }
}
