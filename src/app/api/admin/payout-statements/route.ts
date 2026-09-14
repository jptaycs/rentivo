import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Prepare a draft payout statement for one host (082).
 *
 * `expectedAmount` is the figure the admin was LOOKING AT when they clicked —
 * not a number this route computes. create_payout_statement itemizes the
 * bookings itself and refuses if the total it arrives at differs, so a booking
 * that completed between the page render and the click produces a readable
 * refusal instead of a draft for a different amount than the admin approved.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate

  let body: { hostId?: unknown; expectedAmount?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // `JSON.parse('null')` succeeds and reaches here as an object-typed null.
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const hostId = typeof body.hostId === 'string' ? body.hostId.trim() : ''
  if (!UUID.test(hostId)) {
    return NextResponse.json({ error: 'A host is required.' }, { status: 400 })
  }
  const expectedAmount = body.expectedAmount
  if (typeof expectedAmount !== 'number' || !Number.isInteger(expectedAmount) || expectedAmount <= 0) {
    return NextResponse.json({ error: 'An expected amount is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('create_payout_statement', {
    p_host_id: hostId,
    p_expected_amount: expectedAmount,
    p_admin_email: gate.email,
  })
  if (error) {
    // Postgres prefixes a raise with its own context ("...: <message>"); show
    // the RPC's sentence, which is written to be read by the admin.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const request = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ request })
}
