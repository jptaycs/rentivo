import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isPayMongoConfigured,
  createPaymentIntent,
  createQrPhPaymentMethod,
  attachPaymentIntent,
  getPaymentIntent,
  paymentErrorMessage,
} from '@/lib/paymongo'
import { periodLabel } from '@/lib/billing'

/**
 * Host pays a commission bill via QR Ph.
 *
 * If the bill already has a live PayMongo intent from an earlier click, that
 * intent is checked first (fix round 1, finding 2): a `succeeded` intent
 * marks the bill paid right away — closing the window where the host had
 * already scanned the first QR but a second click's fresh intent would
 * overwrite `paymongo_ref` out from under it, leaving the webhook unable to
 * find a bill for the money that actually arrived. An intent still
 * `awaiting_next_action` is reused as-is (same QR returned again, no new
 * intent minted) rather than orphaned. Only when the existing intent is
 * cancelled/failed/otherwise unusable does this mint a fresh one.
 *
 * The intent id is stored on `host_bills.paymongo_ref` (the webhook matches
 * on it) before the QR-Ph method is attached — if that write fails, the
 * route bails out with 502 rather than handing the host a QR the webhook
 * could never credit (fix round 1, finding 1).
 *
 * Only the bill's own host can reach this route (RLS + explicit filter).
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

  const { data: bill } = await supabase
    .from('host_bills')
    .select('id, host_id, period, amount, status, paymongo_ref')
    .eq('id', id)
    .eq('host_id', user.id)
    .maybeSingle()
  if (!bill) {
    return NextResponse.json({ error: 'Bill not found.' }, { status: 404 })
  }
  if (bill.status !== 'issued') {
    return NextResponse.json({ error: `This bill is already ${bill.status}.` }, { status: 400 })
  }
  if (!isPayMongoConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  }

  const admin = createAdminClient()

  if (bill.paymongo_ref) {
    try {
      const existing = await getPaymentIntent(bill.paymongo_ref)
      if (existing.attributes.status === 'succeeded') {
        const { error: rpcError } = await admin.rpc('mark_host_bill_paid', {
          p_bill_id: bill.id,
          p_paymongo_ref: bill.paymongo_ref,
        })
        if (rpcError) {
          console.error('[bills/pay] mark_host_bill_paid failed for an already-succeeded intent', rpcError)
          return NextResponse.json({ error: rpcError.message }, { status: 500 })
        }
        return NextResponse.json({ status: 'paid', billId: bill.id })
      }
      const existingNextAction = existing.attributes.next_action
      if (
        existing.attributes.status === 'awaiting_next_action' &&
        existingNextAction &&
        'code' in existingNextAction
      ) {
        return NextResponse.json({ qrImage: existingNextAction.code.image_url, billId: bill.id })
      }
      // cancelled / failed / processing / no QR next_action — fall through
      // and mint a fresh intent below.
    } catch (err) {
      console.error('[bills/pay] could not check the existing intent, minting a fresh one', err)
      // fall through and mint a fresh intent below.
    }
  }

  try {
    const intent = await createPaymentIntent({
      amountCentavos: bill.amount * 100,
      description: `Rentivo commission — ${periodLabel(bill.period)}`,
      metadata: { host_bill_id: bill.id },
    })
    const { error: refError } = await admin
      .from('host_bills')
      .update({ paymongo_ref: intent.id })
      .eq('id', bill.id)
    if (refError) {
      console.error('[bills/pay] failed to store paymongo_ref on the bill', refError)
      return NextResponse.json(
        { error: 'Could not start the payment. Please try again.' },
        { status: 502 }
      )
    }

    const pm = await createQrPhPaymentMethod()
    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/bills`
    const attached = await attachPaymentIntent(intent.id, pm.id, returnUrl)
    const nextAction = attached.attributes.next_action
    if (attached.attributes.status === 'awaiting_next_action' && nextAction && 'code' in nextAction) {
      return NextResponse.json({ qrImage: nextAction.code.image_url, billId: bill.id })
    }
    return NextResponse.json({ error: paymentErrorMessage(attached), billId: bill.id }, { status: 502 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed. Please try again.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
