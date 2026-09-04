import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, getPaymentIntent } from '@/lib/paymongo'
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
        // Not a booking: maybe a host commission bill paid via QR Ph (the
        // pay route stores the intent id on host_bills.paymongo_ref).
        // Idempotent RPC, so a replayed event is harmless. No email on bill
        // payment — the Bills page flips to Paid and that is the receipt.
        const { data: bill } = await admin
          .from('host_bills')
          .select('id, status')
          .eq('paymongo_ref', intentId)
          .maybeSingle()
        if (bill) {
          if (bill.status === 'issued') {
            await admin.rpc('mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: intentId })
          } else {
            // A host scanned a QR for a bill that's since been voided or
            // already paid (e.g. an admin voided it in correction mode while
            // the host's QR was still live) and the payment landed anyway.
            // Nothing records it anywhere — log so it's at least discoverable
            // in Vercel logs rather than silently lost.
            console.error('[webhook] payment.paid matched a non-issued host_bill — payment unrecorded', {
              intentId,
              billId: bill.id,
              billStatus: bill.status,
            })
          }
        } else {
          // Fix round 1, finding 2(b): a stale intent — no row currently has
          // this id as its CURRENT paymongo_ref (e.g. an earlier "pay" click
          // whose intent later got superseded, from before the pay route
          // started reusing a live intent instead of overwriting it). The
          // intent's own PayMongo-side metadata still names the bill it was
          // minted for, so ask PayMongo directly rather than losing the
          // payment. Never let a failure here escape the webhook — PayMongo
          // will otherwise retry the whole event indefinitely.
          try {
            const intent = await getPaymentIntent(intentId)
            const billId = intent.attributes.metadata?.host_bill_id
            if (billId) {
              const { data: staleBill } = await admin
                .from('host_bills')
                .select('id, status')
                .eq('id', billId)
                .maybeSingle()
              if (staleBill && staleBill.status === 'issued') {
                // mark_host_bill_paid coalesces paymongo_ref, but a non-null
                // p_paymongo_ref (always the case here) always wins — this
                // overwrites whatever ref the bill currently holds. Could
                // orphan a newer intent if the host pays a fresh QR for the
                // same bill between this stale intent being minted and it
                // finally resolving; accepted as a narrow edge case.
                await admin.rpc('mark_host_bill_paid', {
                  p_bill_id: staleBill.id,
                  p_paymongo_ref: intentId,
                })
              } else {
                console.error('[webhook] payment.paid matched a non-issued host_bill via stale-intent metadata — payment unrecorded', {
                  intentId,
                  billId,
                  billStatus: staleBill?.status ?? 'not_found',
                })
              }
            }
          } catch (e) {
            console.error('[webhook] could not resolve a stale bill intent', intentId, e)
          }
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
