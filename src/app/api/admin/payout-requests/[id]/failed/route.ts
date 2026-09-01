import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutFailed } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: request, error } = await admin.rpc('mark_payout_failed', {
    p_request_id: id,
    p_notes: reason,
  })
  if (error || !request) {
    return NextResponse.json({ error: error?.message ?? 'Mark failed failed.' }, { status: 400 })
  }

  notifyPayoutFailed(request.host_id, request.amount, reason).catch((e) =>
    console.error('[email] notifyPayoutFailed failed', e)
  )

  return NextResponse.json({ request })
}
