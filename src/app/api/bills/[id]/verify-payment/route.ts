import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPayMongoConfigured, getPaymentIntent } from '@/lib/paymongo'

/** Same escape hatch as /api/bookings/[id]/verify-payment: QR Ph has no
 *  redirect back, so if the webhook is delayed the host can ask PayMongo
 *  directly. mark_host_bill_paid is idempotent, so repeated calls are safe. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: bill } = await supabase
    .from('host_bills')
    .select('id, status, paymongo_ref')
    .eq('id', id)
    .eq('host_id', user.id)
    .maybeSingle()
  if (!bill) return NextResponse.json({ error: 'Bill not found.' }, { status: 404 })
  if (bill.status === 'paid') return NextResponse.json({ status: 'paid' })
  if (!bill.paymongo_ref || !isPayMongoConfigured()) return NextResponse.json({ status: 'unpaid' })

  try {
    const intent = await getPaymentIntent(bill.paymongo_ref)
    const s = intent.attributes.status
    if (s === 'succeeded') {
      const admin = createAdminClient()
      const { error } = await admin.rpc('mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: bill.paymongo_ref })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ status: 'paid' })
    }
    return NextResponse.json({ status: s === 'processing' ? 'processing' : 'unpaid' })
  } catch {
    return NextResponse.json({ error: "Couldn't reach PayMongo to check this payment. Please try again." }, { status: 502 })
  }
}
