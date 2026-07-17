import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature } from '@/lib/paymongo'

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
        .select('id')
        .eq('paymongo_ref', intentId)
        .maybeSingle()
      if (booking) {
        await admin.rpc('mark_booking_paid', {
          p_booking_id: booking.id,
          p_paymongo_ref: intentId,
        })
      }
    }
  }

  return NextResponse.json({ received: true })
}
