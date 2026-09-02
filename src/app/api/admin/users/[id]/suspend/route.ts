import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminEmail } from '@/lib/admin-emails'
import { notifyAccountSuspended } from '@/lib/email'

/** ~100 years. GoTrue has no "forever", so a duration past any plausible
 *  account lifetime is the idiom. Un-suspend sets 'none'. */
const BAN_DURATION = '876000h'

/** Same shape as src/lib/hosts.ts and src/lib/account-deletion.ts. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Suspend an account: block login (GoTrue ban) and set profiles.suspended_at,
 * which every listing/booking/payout read path checks (migrations 045–047).
 *
 * The reason lives in exactly TWO places: the admin_actions row written below,
 * and the suspension email. There is deliberately no column for it —
 * profiles.suspension_reason existed briefly (044) and was dropped in 047
 * because `profiles` carries `public read using (true)`, which made admin-written
 * free text about a user world-readable via raw PostgREST. See 047's header
 * before considering re-adding one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  // Shape-check the path segment before it reaches any query. checkDeletionEligibility
  // guards itself too, but this route needs its own check to keep 400-vs-500 honest.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 })
  }

  let body: { reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, full_name, suspended_at')
    .eq('id', id)
    .maybeSingle()
  if (targetError || !target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // Refuse to suspend an admin — including yourself. Locking the only admin out
  // of the panel would leave nobody able to undo it.
  const { data: authUser } = await admin.auth.admin.getUserById(id)
  if (isAdminEmail(authUser?.user?.email)) {
    return NextResponse.json({ error: 'Admin accounts cannot be suspended.' }, { status: 400 })
  }

  // Order matters: mark the profile first. If the ban call then fails, the
  // account reads as suspended and its listings are already hidden — the safe
  // direction to fail in. The reverse order could leave a banned account that
  // still shows as active in the panel.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ suspended_at: new Date().toISOString() })
    .eq('id', id)
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: BAN_DURATION,
  })
  if (banError) {
    return NextResponse.json(
      { error: `Profile marked suspended, but the login block failed: ${banError.message}` },
      { status: 500 }
    )
  }

  // The ONLY durable record of why. Not fire-and-forget, and not optional:
  // there is no schema left that would catch a lost reason.
  // Supabase's User type has `email?: string`, while admin_actions.admin_email
  // is `text not null` — fall back rather than letting the audit insert fail and
  // lose the record of who did this.
  const { error: auditError } = await admin.from('admin_actions').insert({
    admin_email: gate.email ?? 'unknown',
    action: 'suspend',
    target_user_id: id,
    detail: { reason },
  })
  if (auditError) {
    console.error('[admin] suspend audit insert failed', auditError)
  }

  notifyAccountSuspended(id, reason).catch((e) =>
    console.error('[email] notifyAccountSuspended failed', e)
  )

  return NextResponse.json({ ok: true })
}
