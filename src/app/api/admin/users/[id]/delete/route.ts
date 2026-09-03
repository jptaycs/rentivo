import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminEmail } from '@/lib/admin-emails'
import { checkDeletionEligibility, deleteAccount } from '@/lib/account-deletion'

/** Same shape as src/lib/hosts.ts and src/lib/account-deletion.ts. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Admin-initiated account deletion. Runs the exact same gates and the exact same
 * deletion as the self-service route (both go through src/lib/account-deletion.ts) —
 * an admin gets no override. Removing a host mid-rental would strand a real
 * renter's paid booking; suspension is the escape hatch for that case.
 *
 * No email on deletion — the account is gone and the address anonymized.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 })
  }

  let body: { confirm?: string } | null
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
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: authUser } = await admin.auth.admin.getUserById(id)
  if (!authUser?.user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }
  if (isAdminEmail(authUser.user.email)) {
    return NextResponse.json({ error: 'Admin accounts cannot be deleted.' }, { status: 400 })
  }

  const eligibility = await checkDeletionEligibility(id)
  if (!eligibility.ok) {
    // A *blocked* result always carries a non-empty blocker. An empty one means
    // the check could not be performed (a failed query), and `reason` is then a
    // raw diagnostic — a 500, not a 400 leaking a Postgres string as user copy.
    // Note also: when bookings block, `pendingPayouts: 0` (or `issuedBills: 0`)
    // may mean "unknown" rather than "none", since neither query is short-circuited.
    if (
      eligibility.blocking.bookings.length > 0 ||
      eligibility.blocking.pendingPayouts > 0 ||
      eligibility.blocking.issuedBills > 0
    ) {
      return NextResponse.json(
        { error: eligibility.reason, blocking: eligibility.blocking },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: eligibility.reason }, { status: 500 })
  }

  // Audit BEFORE the delete: afterwards the profile is anonymized and the auth
  // user soft-deleted, so this row is the only remaining record of who was
  // removed and by whom.
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', id)
    .maybeSingle()

  const { error: auditError } = await admin.from('admin_actions').insert({
    admin_email: gate.email ?? 'unknown',
    action: 'delete',
    target_user_id: id,
    detail: {
      email: authUser.user.email ?? null,
      full_name: targetProfile?.full_name ?? null,
    },
  })
  if (auditError) {
    // FATAL here, unlike suspend/unsuspend. Deletion is irreversible and
    // anonymizing: once deleteAccount runs, full_name reads 'Deleted User' and
    // the auth address is gone, so the { email, full_name } captured above
    // becomes unrecoverable. Proceeding would complete an irreversible action
    // with no record of who was removed or by whom. Nothing has happened yet at
    // this point, so the admin can simply retry.
    console.error('[admin] delete audit insert failed — deletion aborted', auditError)
    return NextResponse.json(
      { error: `Could not write the audit record, so the deletion was not performed: ${auditError.message}` },
      { status: 500 }
    )
  }

  const result = await deleteAccount(id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
