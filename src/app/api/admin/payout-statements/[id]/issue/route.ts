import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailStatement } from '@/lib/payout-statement-email'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Record that the transfer for a draft statement was actually made (082).
 *
 * This is the point a gapless statement number is permanently consumed, so the
 * route validates before calling and lets the RPC own every rule that matters
 * (idempotent on the same reference, refuses a different one, refuses a future
 * transfer date or one before the draft existed).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reference?: unknown; transferredOn?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  if (!reference) {
    return NextResponse.json({ error: 'A transfer reference is required.' }, { status: 400 })
  }
  if (reference.length > 100) {
    return NextResponse.json(
      { error: 'The transfer reference must be 100 characters or fewer.' },
      { status: 400 }
    )
  }

  const transferredOn = typeof body.transferredOn === 'string' ? body.transferredOn.trim() : ''
  // Shape first, then reality: '2026-02-31' matches the pattern but is not a
  // date, and Postgres would reject it with its own less readable message.
  if (!DATE.test(transferredOn) || !isRealDate(transferredOn)) {
    return NextResponse.json({ error: 'A valid transfer date is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('issue_payout_statement', {
    p_request_id: id,
    p_reference: reference,
    p_transferred_on: transferredOn,
    p_admin_email: gate.email,
  })
  if (error) {
    return NextResponse.json({ error: error.message.replace(/^.*?: /, '') }, { status: 400 })
  }
  const request = Array.isArray(data) ? data[0] : data

  // Awaited, not fire-and-forget: the result decides statement_emailed_at. A
  // failed send does NOT fail the request — the transfer really happened and
  // must stay recorded; the admin page shows "Email not sent — Resend".
  const emailed = await emailStatement(request.id, false)

  return NextResponse.json({ request, emailed })
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  )
}
