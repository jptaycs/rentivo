import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isPayMongoConfigured,
  createPaymentIntent,
  createEwalletPaymentMethod,
  attachPaymentIntent,
  paymentErrorMessage,
} from '@/lib/paymongo'
import { notifyBookingPaid } from '@/lib/email'
import type { Booking } from '@/types'

interface CheckoutBody {
  listingId?: string
  pickupDate?: string
  returnDate?: string
  isDelivery?: boolean
  deliveryAddress?: string | null
  method?: 'gcash' | 'maya' | 'card' | 'apple_pay' | 'google_pay'
  phone?: string | null
  promoCode?: string | null
  /** Card payment method created in the browser with the public key */
  paymentMethodId?: string | null
  /** Reuse an unpaid booking from a previous failed attempt */
  bookingId?: string | null
}

const CHARGEABLE = { gcash: 'gcash', maya: 'paymaya', card: 'card' } as const

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
      { error: 'This payment method is not available yet. Please choose GCash, Maya, or Card.' },
      { status: 400 }
    )
  }

  // ── 1. Create the booking (or reuse the one from a failed attempt) ──
  let booking: Booking
  if (body.bookingId) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', body.bookingId)
      .eq('renter_id', user.id)
      .eq('payment_status', 'unpaid')
      .eq('status', 'pending')
      .single()
    if (error || !data) {
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
      case 'awaiting_next_action':
        return NextResponse.json({
          status: 'redirect',
          url: attached.attributes.next_action?.redirect.url ?? returnUrl,
          bookingId: booking.id,
        })
      case 'processing':
        return NextResponse.json({ status: 'redirect', url: returnUrl, bookingId: booking.id })
      default:
        return NextResponse.json(
          { error: paymentErrorMessage(attached), bookingId: booking.id },
          { status: 402 }
        )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed. Please try again.'
    return NextResponse.json({ error: message, bookingId: booking.id }, { status: 502 })
  }
}
