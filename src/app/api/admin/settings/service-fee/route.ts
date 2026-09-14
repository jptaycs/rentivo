import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Set the platform service-fee rate (080/081).
 *
 * This is the one endpoint that changes the price every renter pays, so both
 * the validation and the audit trail are deliberate:
 *
 * - The body is validated HERE **and** again inside set_service_fee_bps. The
 *   route's check exists to give a readable 400; the RPC's is the one that
 *   cannot be bypassed (it is the only thing a direct service-role caller would
 *   hit, and this route is not the only possible caller of the RPC).
 * - The audit row is written INSIDE the RPC, in the same transaction as the
 *   rate change (080). This route must NOT insert one — the pattern the other
 *   admin routes use (call the RPC, then insert admin_actions) can leave a
 *   money change unaudited if the second call fails.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate

  let body: { bps?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // `JSON.parse('null')` succeeds and reaches here as an object-typed null,
  // which would throw on the property reads below.
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const bps = body.bps
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 2000) {
    return NextResponse.json(
      { error: 'The service fee must be a whole number of basis points between 0 and 2000 (0% and 20%).' },
      { status: 400 }
    )
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('set_service_fee_bps', {
    p_bps: bps,
    p_reason: reason,
    p_admin_email: gate.email,
  })
  if (error) {
    // PostgREST returns a raise's text as-is (no "...: " prefix), and the RPC's
    // sentence is written to be read by the admin — pass it through untouched.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json(row)
}
