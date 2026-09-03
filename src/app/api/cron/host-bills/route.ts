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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
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
  for (const bill of bills) {
    notifyHostBillIssued(bill.id).catch((e) => console.error('[email] notifyHostBillIssued failed', e))
  }
  return NextResponse.json({ period, created: bills.length })
}
