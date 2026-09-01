import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyVerificationReviewed } from '@/lib/email'

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
  const { data: request, error } = await admin.rpc('review_verification_request', {
    p_request_id: id,
    p_approve: body.approve,
    p_notes: notes,
  })
  if (error || !request) {
    return NextResponse.json({ error: error?.message ?? 'Review failed.' }, { status: 400 })
  }

  notifyVerificationReviewed(request.user_id, body.approve, notes).catch((e) =>
    console.error('[email] notifyVerificationReviewed failed', e)
  )

  return NextResponse.json({ request })
}
