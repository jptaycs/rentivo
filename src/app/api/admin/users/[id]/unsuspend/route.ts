import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAccountReinstated } from '@/lib/email'

/** Same shape as src/lib/hosts.ts and src/lib/account-deletion.ts. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reinstate a suspended account: lift the GoTrue ban and clear
 * profiles.suspended_at. No body — there is nothing to say.
 *
 * There is no suspension_reason column to clear (dropped in 047); the reason
 * stays in the admin_actions history, which is an audit log and is not rewritten.
 *
 * Deliberately NOT guarded on "already active", unlike the suspend route's
 * already-suspended check. This is the recovery path: both halves of a
 * suspension can end up half-applied (suspend's ban_failed branch, or this
 * route's own profileError branch), and refusing to run against an account that
 * looks active would strand exactly those states. Re-running it is harmless —
 * the cost is a redundant reinstatement email, against a stuck account.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (targetError || !target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // Lift the login ban FIRST here — the mirror of suspend's ordering. If the
  // profile update then fails, the account still reads as suspended and its
  // listings stay hidden, which is again the safe direction to fail in.
  const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
  if (banError) {
    return NextResponse.json({ error: banError.message }, { status: 500 })
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ suspended_at: null })
    .eq('id', id)
  if (profileError) {
    // Be explicit about the half-applied state: the ban is already gone, so the
    // user can sign in while suspended_at still hides their listings. Safe
    // direction, but an admin reading a bare Postgres message could not tell.
    // Re-running this route clears it — that's the point: this route is
    // deliberately idempotent (see the doc comment above), so retrying from
    // this half-applied state is the recovery path, not a hazard.
    return NextResponse.json(
      { error: `Login ban lifted, but clearing the suspension flag failed: ${profileError.message}` },
      { status: 500 }
    )
  }

  const { error: auditError } = await admin.from('admin_actions').insert({
    admin_email: gate.email ?? 'unknown',
    action: 'unsuspend',
    target_user_id: id,
    detail: null,
  })
  if (auditError) {
    console.error('[admin] unsuspend audit insert failed', auditError)
  }

  notifyAccountReinstated(id).catch((e) =>
    console.error('[email] notifyAccountReinstated failed', e)
  )

  return NextResponse.json({ ok: true })
}
