import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkDeletionEligibility, deleteAccount } from '@/lib/account-deletion'

/**
 * Self-service account deletion. Anonymizes the profile rather than
 * hard-deleting it — bookings/reviews/messages reference profiles
 * without ON DELETE CASCADE, and profiles->auth.users does cascade, so
 * a hard auth delete would wipe the very profile row this anonymizes.
 * See docs/superpowers/specs/2026-07-30-self-service-account-deletion-design.md
 *
 * The deletion itself lives in src/lib/account-deletion.ts, shared with the
 * admin delete route. This route owns only the confirm check, the session
 * handling, the HTTP status codes, and the second-person wording a real user
 * sees for the three eligibility gates.
 */
export async function POST(req: Request) {
  let body: { confirm?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }
  const uid = user.id

  const eligibility = await checkDeletionEligibility(uid)
  if (!eligibility.ok) {
    // The module's reasons are admin-facing third-person; map them back to the
    // second-person wording this route has always returned to the user. A gate is
    // only ever *blocked* with a non-empty blocker, so an empty one means the check
    // could not be performed at all (a failed query — or a malformed uid, which a
    // verified session can't produce) — which this route has always reported as a
    // 500 carrying the raw error message, not a 400.
    if (eligibility.blocking.issuedBills > 0) {
      return NextResponse.json(
        {
          error:
            'You have an unpaid commission bill. Please pay it from your Bills page before deleting your account.',
        },
        { status: 400 }
      )
    }
    if (eligibility.blocking.bookings.length > 0) {
      return NextResponse.json(
        {
          error:
            'You have an active booking. Please wait for it to complete or cancel it before deleting your account.',
        },
        { status: 400 }
      )
    }
    if (eligibility.blocking.pendingPayouts > 0) {
      return NextResponse.json(
        {
          error:
            'You have a payout in progress. Please wait for it to be processed before deleting your account.',
        },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: eligibility.reason }, { status: 500 })
  }

  const result = await deleteAccount(uid)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
