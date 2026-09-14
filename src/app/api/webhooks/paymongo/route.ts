import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, getPaymentIntent } from '@/lib/paymongo'
import { handlePaymentPaid, type WebhookBooking, type WebhookPayment } from '@/lib/paymongo-webhook'
import { notifyBookingPaid } from '@/lib/email'

const BOOKING_COLUMNS = 'id, payment_status, status, total_amount, paymongo_ref'

/**
 * PayMongo webhook — source of truth for payment confirmation.
 * Register https://<domain>/api/webhooks/paymongo for the
 * `payment.paid` event and set PAYMONGO_WEBHOOK_SECRET to the
 * webhook's secret key (whsk_...).
 *
 * The decision logic (ref match, the metadata fallback for a stale intent from
 * a checkout retry, and the loud logging of anything unmatched) lives in
 * src/lib/paymongo-webhook.ts so it can be tested without a server.
 */
export async function POST(req: Request) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 })
  }

  const rawBody = await req.text()
  const verified = verifyWebhookSignature(rawBody, req.headers.get('paymongo-signature'), secret)
  if (!verified.ok) {
    if (verified.reason === 'stale') {
      console.warn('[webhook] rejected correctly signed event with a stale timestamp (possible replay)')
    }
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let event: {
    data?: {
      attributes?: {
        type?: string
        data?: { id?: string; attributes?: { payment_intent_id?: string; amount?: number; currency?: string } }
      }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }

  if (event.data?.attributes?.type === 'payment.paid') {
    const paymentResource = event.data.attributes.data
    const intentId = paymentResource?.attributes?.payment_intent_id
    if (!intentId) {
      console.error('[webhook] UNMATCHED PAYMENT: payment.paid event carries no payment_intent_id', {
        paymentId: paymentResource?.id ?? null,
      })
      return NextResponse.json({ received: true })
    }

    const admin = createAdminClient()
    const payment: WebhookPayment = {
      amount: paymentResource?.attributes?.amount,
      currency: paymentResource?.attributes?.currency,
    }

    const outcome = await handlePaymentPaid(intentId, payment, {
      async findBookingByRef(ref) {
        const { data, error } = await admin.from('bookings').select(BOOKING_COLUMNS).eq('paymongo_ref', ref).maybeSingle()
        if (error) throw new Error(error.message)
        return data as WebhookBooking | null
      },
      async findBookingById(id) {
        const { data, error } = await admin.from('bookings').select(BOOKING_COLUMNS).eq('id', id).maybeSingle()
        // A malformed metadata id is a Postgres cast error — treat as not found.
        if (error) return null
        return data as WebhookBooking | null
      },
      getIntent: getPaymentIntent,
      async markPaid(bookingId, ref) {
        const { error } = await admin.rpc('mark_booking_paid', { p_booking_id: bookingId, p_paymongo_ref: ref })
        return { error: error ? error.message : null }
      },
      notifyPaid(bookingId) {
        notifyBookingPaid(bookingId).catch((e) => console.error('[email] notifyBookingPaid failed', e))
      },
      alert(message, detail) {
        console.error(`[webhook] ${message}`, { ...detail, paymentId: paymentResource?.id ?? null })
      },
    }).catch((err) => {
      console.error('[webhook] payment.paid handling threw — will retry', {
        intentId,
        error: err instanceof Error ? err.message : String(err),
      })
      return 'retry' as const
    })

    if (outcome === 'retry') {
      return NextResponse.json({ error: 'Temporary failure; retry.' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
