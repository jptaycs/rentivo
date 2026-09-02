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

/** GoTrue reports an un-banned user as an absent/past banned_until. */
function isBanned(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false
  const t = Date.parse(bannedUntil)
  return Number.isFinite(t) && t > Date.now()
}

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

  let body: { reason?: string } | null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  // `JSON.parse('null')` succeeds, so a literal `null` body reaches here as an
  // object-typed null and would throw on the property read below.
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, suspended_at')
    .eq('id', id)
    .maybeSingle()
  if (targetError || !target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // Fail CLOSED on a GoTrue error: `{ data: { user: null }, error }` would make
  // isAdminEmail(undefined) false and let an admin be suspended. Resolve the auth
  // user first and treat "couldn't read it" as "not found", never as "not an admin".
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(id)
  if (authUserError || !authUser?.user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // Refuse to suspend an admin — including yourself. Locking the only admin out
  // of the panel would leave nobody able to undo it.
  if (isAdminEmail(authUser.user.email)) {
    return NextResponse.json({ error: 'Admin accounts cannot be suspended.' }, { status: 400 })
  }

  // Refuse a redundant suspension: it would rewrite suspended_at to now, append a
  // second audit row, and re-send the suspension email to someone already suspended.
  // The check is deliberately on BOTH halves being applied, not on suspended_at
  // alone — a partially-applied suspension (the ban_failed path below leaves the
  // flag set and the ban unapplied) must stay retryable, and a bare
  // `suspended_at is not null` test would strand exactly that state.
  if (target.suspended_at && isBanned(authUser.user.banned_until)) {
    return NextResponse.json({ error: 'This account is already suspended.' }, { status: 400 })
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
    // The profile is already flagged — listings hidden, protected routes blocked —
    // so this half-applied state must not be left with no record of why or by whom.
    // suspension_reason no longer exists (047), so this row is the only thing that
    // could ever explain the flag. Written BEFORE returning, flagged as partial.
    const { error: partialAuditError } = await admin.from('admin_actions').insert({
      admin_email: gate.email ?? 'unknown',
      action: 'suspend',
      target_user_id: id,
      detail: { reason, ban_failed: true },
    })
    if (partialAuditError) {
      console.error('[admin] suspend partial-failure audit insert failed', partialAuditError)
    }
    // No email on this path: login still works, so telling the user they can't
    // sign in would be false. The 500 tells the admin to retry, and the
    // already-suspended guard above deliberately allows that retry.
    return NextResponse.json(
      { error: `Profile marked suspended, but the login block failed: ${banError.message}` },
      { status: 500 }
    )
  }

  // The ONLY durable record of why. Non-fatal here — unlike the delete route — because
  // the suspension has already fully applied and a failed audit must not undo it.
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
