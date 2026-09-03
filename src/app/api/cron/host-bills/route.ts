import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyHostBillIssued } from '@/lib/email'
import { previousPeriod } from '@/lib/billing'
import type { HostBill } from '@/types'

/**
 * Monthly commission billing. Vercel cron (vercel.json) calls this at 01:00
 * UTC on the 1st with `Authorization: Bearer <CRON_SECRET>`; anything else
 * is a 401. generate_host_bills is idempotent, so a rerun creates nothing.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Constant-time secret check — a naive `===` leaks timing information on
 *  how many leading bytes matched. Missing CRON_SECRET fails closed (401). */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(req.headers.get('authorization') ?? '')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const period = previousPeriod()
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_host_bills', { p_period: period })
  if (error) {
    console.error('[cron] generate_host_bills failed', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
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
