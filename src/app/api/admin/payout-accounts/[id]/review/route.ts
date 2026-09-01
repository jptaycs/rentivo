import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutAccountReviewed } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { approve?: boolean; notes?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (typeof body.approve !== 'boolean') {
    return NextResponse.json({ error: 'approve (boolean) is required.' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null

  const admin = createAdminClient()
  const { data: account, error } = await admin.rpc('review_payout_account', {
    p_account_id: id,
    p_approve: body.approve,
    p_notes: notes,
  })
  if (error || !account) {
    return NextResponse.json({ error: error?.message ?? 'Review failed.' }, { status: 400 })
  }

  notifyPayoutAccountReviewed(account.user_id, body.approve, notes).catch((e) =>
    console.error('[email] notifyPayoutAccountReviewed failed', e)
  )

  return NextResponse.json({ account })
}
