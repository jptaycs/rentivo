import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyHostBillIssued } from '@/lib/email'
import { normalizePeriod } from '@/lib/billing'
import type { HostBill } from '@/types'

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

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_host_bills', { p_period: period })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const bills = (data ?? []) as HostBill[]
  for (const bill of bills) {
    notifyHostBillIssued(bill.id).catch((e) => console.error('[email] notifyHostBillIssued failed', e))
  }
  return NextResponse.json({ period, created: bills.length })
}
