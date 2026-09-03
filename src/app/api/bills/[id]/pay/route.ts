import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isPayMongoConfigured,
  createPaymentIntent,
  createQrPhPaymentMethod,
  attachPaymentIntent,
  paymentErrorMessage,
} from '@/lib/paymongo'
import { periodLabel } from '@/lib/billing'

/**
 * Host pays a commission bill via QR Ph. Creates a PayMongo intent tagged
 * with the bill id, stores the intent id on the bill (the webhook matches on
 * it), attaches a qrph method and returns the QR image to scan. A second
 * click overwrites paymongo_ref with a fresh intent; the earlier one never
 * pays. Only the bill's own host can reach it (RLS + explicit filter).
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
    .select('id, host_id, period, amount, status')
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

  try {
    const admin = createAdminClient()
    const intent = await createPaymentIntent({
      amountCentavos: bill.amount * 100,
      description: `Rentivo commission — ${periodLabel(bill.period)}`,
      metadata: { host_bill_id: bill.id },
    })
    await admin.from('host_bills').update({ paymongo_ref: intent.id }).eq('id', bill.id)

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
