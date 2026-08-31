import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Self-service account deletion. Anonymizes the profile rather than
 * hard-deleting it — bookings/reviews/messages reference profiles
 * without ON DELETE CASCADE, and profiles->auth.users does cascade, so
 * a hard auth delete would wipe the very profile row this anonymizes.
 * See docs/superpowers/specs/2026-07-30-self-service-account-deletion-design.md
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
  const admin = createAdminClient()

  // Eligibility gate: block while any booking isn't in a final state
  const { data: blocking, error: blockingError } = await admin
    .from('bookings')
    .select('id')
    .or(`renter_id.eq.${uid},host_id.eq.${uid}`)
    .in('status', ['pending', 'confirmed', 'active'])
    .limit(1)
  if (blockingError) {
    return NextResponse.json({ error: blockingError.message }, { status: 500 })
  }
  if (blocking && blocking.length > 0) {
    return NextResponse.json(
      {
        error:
          'You have an active booking. Please wait for it to complete or cancel it before deleting your account.',
      },
      { status: 400 }
    )
  }

  // Anonymize the profile — keep the row, scrub PII
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: 'Deleted User',
      avatar_url: null,
      bio: null,
      city: null,
      is_host: false,
      is_verified: false,
    })
    .eq('id', uid)
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // Deactivate listings — never hard-delete, they may have booking history
  const { error: listingsError } = await admin.from('listings').update({ is_active: false }).eq('host_id', uid)
  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 })
  }

  // Capture verification doc storage paths before deleting the row
  const { data: verifications, error: verificationsReadError } = await admin
    .from('verification_requests')
    .select('id_doc_path, selfie_path')
    .eq('user_id', uid)
  if (verificationsReadError) {
    return NextResponse.json({ error: verificationsReadError.message }, { status: 500 })
  }

  // Anonymize payout_accounts in place (don't delete) — payout_requests.payout_account_id
  // references it with no ON DELETE clause, and payout_requests must never be touched,
  // so deleting this row would throw an unrecoverable FK violation for any host who has
  // ever requested a payout. account_number/account_name are NOT NULL, so scrub with a
  // placeholder rather than nulling them.
  const { error: payoutAccountError } = await admin
    .from('payout_accounts')
    .update({ account_number: 'DELETED', account_name: 'Deleted User' })
    .eq('user_id', uid)
  if (payoutAccountError) {
    return NextResponse.json({ error: `Failed to clean up payout_accounts: ${payoutAccountError.message}` }, { status: 500 })
  }

  // Delete sensitive/disposable rows — no counterparty depends on any of these
  for (const table of ['verification_requests', 'notifications', 'wishlist', 'recently_viewed_listings'] as const) {
    const { error } = await admin.from(table).delete().eq('user_id', uid)
    if (error) {
      return NextResponse.json({ error: `Failed to clean up ${table}: ${error.message}` }, { status: 500 })
    }
  }

  // Storage cleanup: avatars (list, since avatar_url is a public URL not a stored path)
  const { data: avatarFiles, error: avatarListError } = await admin.storage.from('avatars').list(uid)
  if (avatarListError) {
    return NextResponse.json({ error: avatarListError.message }, { status: 500 })
  }
  if (avatarFiles && avatarFiles.length > 0) {
    const { error: avatarRemoveError } = await admin.storage
      .from('avatars')
      .remove(avatarFiles.map((f) => `${uid}/${f.name}`))
    if (avatarRemoveError) {
      return NextResponse.json({ error: avatarRemoveError.message }, { status: 500 })
    }
  }

  // Storage cleanup: verification docs (paths captured above, exact stored paths)
  const docPaths = (verifications ?? [])
    .flatMap((v) => [v.id_doc_path, v.selfie_path])
    .filter((p): p is string => Boolean(p))
  if (docPaths.length > 0) {
    const { error: docRemoveError } = await admin.storage.from('verification-docs').remove(docPaths)
    if (docRemoveError) {
      return NextResponse.json({ error: docRemoveError.message }, { status: 500 })
    }
  }

  // Last step: soft-delete the auth user. shouldSoftDelete=true keeps the
  // auth.users row (blocks login only) so profiles.id's FK never cascades.
  const { error: authError } = await admin.auth.admin.deleteUser(uid, true)
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
