import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutPaid } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reference?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  if (!reference) {
    return NextResponse.json({ error: 'reference is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: request, error } = await admin.rpc('mark_payout_paid', {
    p_request_id: id,
    p_reference: reference,
  })
  if (error || !request) {
    return NextResponse.json({ error: error?.message ?? 'Mark paid failed.' }, { status: 400 })
  }

  notifyPayoutPaid(request.host_id, request.amount, reference).catch((e) =>
    console.error('[email] notifyPayoutPaid failed', e)
  )

  return NextResponse.json({ request })
}
