import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailStatement } from '@/lib/payout-statement-email'

/**
 * Send a host their statement email again (082) — the recovery path for a send
 * that failed while the transfer itself was recorded fine.
 *
 * Which email goes out is read from the row, not from the caller: a reversed
 * statement gets the reversal notice, an issued one the statement. A draft has
 * no number and nothing to send, so it is refused rather than silently no-oping.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('payout_requests')
    .select('id, statement_number, reversed_at')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: 'Could not read the statement.' }, { status: 400 })
  }
  if (!row) {
    return NextResponse.json({ error: 'Payout statement not found.' }, { status: 400 })
  }
  if (!row.statement_number) {
    return NextResponse.json(
      { error: 'This statement has not been issued yet — there is nothing to send.' },
      { status: 400 }
    )
  }

  const emailed = await emailStatement(row.id, row.reversed_at !== null)
  return NextResponse.json({ emailed })
}
