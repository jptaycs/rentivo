import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailStatement } from '@/lib/payout-statement-email'

/**
 * Undo an issued statement (082).
 *
 * ⚠️ This is the most dangerous action in the admin panel. Reversing releases
 * the statement's bookings back into what the host is owed — so reversing a
 * transfer that ACTUALLY ARRIVED sets the host up to be paid for it a second
 * time. Nothing in the database can tell whether the money landed, so the
 * safeguard is deliberately human: the admin must type the statement number
 * back, and give a reason. The typed number is re-checked HERE against the
 * stored row (the client's disabled button is a convenience, not the gate) so
 * a hand-rolled POST cannot skip it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: unknown; confirmStatementNumber?: unknown }
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
    return NextResponse.json({ error: 'A reason is required to reverse a statement.' }, { status: 400 })
  }
  const typed =
    typeof body.confirmStatementNumber === 'string' ? body.confirmStatementNumber.trim() : ''
  if (!typed) {
    return NextResponse.json(
      { error: 'Type the statement number to confirm the reversal.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data: row, error: readError } = await admin
    .from('payout_requests')
    .select('id, statement_number, reversed_at')
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ error: 'Could not read the statement.' }, { status: 400 })
  }
  if (!row) {
    return NextResponse.json({ error: 'Payout statement not found.' }, { status: 400 })
  }
  // A draft has no number — the RPC would refuse it too, but say so plainly
  // rather than claiming the typed number is wrong.
  if (!row.statement_number) {
    return NextResponse.json(
      { error: 'This is a draft, not an issued statement — cancel it instead.' },
      { status: 400 }
    )
  }
  if (row.statement_number !== typed) {
    return NextResponse.json({ error: 'The statement number you typed does not match.' }, { status: 400 })
  }

  const { data, error } = await admin.rpc('reverse_payout_statement', {
    p_request_id: id,
    p_reason: reason,
    p_admin_email: gate.email,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const request = Array.isArray(data) ? data[0] : data

  // reverse_payout_statement clears statement_emailed_at when it reverses (084),
  // so a set stamp here means this is a retry of a reversal whose email already
  // went out — don't send "Payout Reversed" twice.
  const emailed = request.statement_emailed_at ? true : await emailStatement(request.id, true)

  return NextResponse.json({ request, emailed })
}
