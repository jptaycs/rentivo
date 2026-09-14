import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Discard a draft statement (082). No email: the host was never told the draft
 * existed, and the bookings simply become owed again.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required to cancel a draft.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('cancel_payout_statement', {
    p_request_id: id,
    p_reason: reason,
    p_admin_email: gate.email,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const request = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ request })
}
