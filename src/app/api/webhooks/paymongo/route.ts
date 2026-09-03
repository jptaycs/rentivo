import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature } from '@/lib/paymongo'
import { notifyBookingPaid } from '@/lib/email'

/**
 * PayMongo webhook — source of truth for payment confirmation.
 * Register https://<domain>/api/webhooks/paymongo for the
 * `payment.paid` event and set PAYMONGO_WEBHOOK_SECRET to the
 * webhook's secret key (whsk_...).
 */
export async function POST(req: Request) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 })
  }

  const rawBody = await req.text()
  if (!verifyWebhookSignature(rawBody, req.headers.get('paymongo-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let event: {
    data?: {
      attributes?: {
        type?: string
        data?: { attributes?: { payment_intent_id?: string } }
      }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 })
  }

  if (event.data?.attributes?.type === 'payment.paid') {
    const intentId = event.data.attributes.data?.attributes?.payment_intent_id
    if (intentId) {
      const admin = createAdminClient()
      const { data: booking } = await admin
        .from('bookings')
        .select('id, payment_status')
        .eq('paymongo_ref', intentId)
        .maybeSingle()
      if (booking) {
        if (booking.payment_status !== 'paid') {
          await admin.rpc('mark_booking_paid', {
            p_booking_id: booking.id,
            p_paymongo_ref: intentId,
          })
          notifyBookingPaid(booking.id).catch((e) => console.error('[email] notifyBookingPaid failed', e))
        }
      } else {
        // Not a booking: a host commission bill paid via QR Ph (the pay route
        // stores the intent id on host_bills.paymongo_ref). Idempotent RPC, so
        // a replayed event is harmless. No email on bill payment — the Bills
        // page flips to Paid and that is the receipt.
        const { data: bill } = await admin
          .from('host_bills')
          .select('id, status')
          .eq('paymongo_ref', intentId)
          .maybeSingle()
        if (bill && bill.status === 'issued') {
          await admin.rpc('mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: intentId })
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
