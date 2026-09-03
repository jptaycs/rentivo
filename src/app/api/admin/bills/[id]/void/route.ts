import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: string; rebill?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // A literal `null`/array/primitive JSON body parses fine above but isn't
  // an object, so `.reason`/`.rebill` would throw rather than fall through
  // to the "reason is required" 400 below.
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 })
  }
  // Default true (correction: release the items so a rerun re-bills them) —
  // matches void_host_bill's own default and the pre-checkbox call shape, so
  // an older/omitted client body still behaves exactly as it always has.
  const rebill = typeof body.rebill === 'boolean' ? body.rebill : true

  const admin = createAdminClient()
  const { data: bill, error } = await admin.rpc('void_host_bill', {
    p_bill_id: id,
    p_reason: reason,
    p_rebill: rebill,
  })
  if (error || !bill) {
    return NextResponse.json({ error: error?.message ?? 'Void failed.' }, { status: 400 })
  }
  return NextResponse.json({ bill })
}
