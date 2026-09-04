import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyHostBillIssued } from '@/lib/email'
import { normalizePeriod, previousPeriod } from '@/lib/billing'
import type { HostBill } from '@/types'

// Same reasoning as src/app/api/cron/host-bills/route.ts: this route also
// awaits every host's notification email before responding, so the default
// function timeout must not freeze it mid-send.
export const maxDuration = 60

export async function POST(req: Request) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate

  let body: { period?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const period = typeof body.period === 'string' ? normalizePeriod(body.period) : null
  if (!period) {
    return NextResponse.json({ error: 'period must be YYYY-MM.' }, { status: 400 })
  }
  // generate_host_bills has no lower bound on paid_at (by design), so a
  // future period would bill every eligible booking since POLICY_START into
  // one bill, permanently. Only a completed month may be billed.
  const latestBillable = previousPeriod()
  if (period > latestBillable) {
    return NextResponse.json(
      { error: `You can only bill a completed month (up to ${latestBillable.slice(0, 7)}).` },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_host_bills', { p_period: period })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const bills = (data ?? []) as HostBill[]
  // A bill notice, not courtesy mail — a host is on a 14-day due-date clock
  // the moment this bill exists, so the send must complete before the
  // function can be frozen post-response, not fire-and-forget.
  const results = await Promise.allSettled(bills.map((bill) => notifyHostBillIssued(bill.id)))
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error('[email] notifyHostBillIssued failed', bills[i].id, result.reason)
    }
  })
  return NextResponse.json({ period, created: bills.length })
}
