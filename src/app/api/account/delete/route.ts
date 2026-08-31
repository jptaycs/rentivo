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

  // Eligibility gate: block while a payout request is still pending. Disbursement is
  // manual — an admin reads payout_accounts.account_number/account_name to send the
  // money — so scrubbing those fields now would strand real owed money with no way
  // for the (locked-out) host to restore it.
  const { data: pendingPayout, error: pendingPayoutError } = await admin
    .from('payout_requests')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'pending')
    .limit(1)
  if (pendingPayoutError) {
    return NextResponse.json({ error: pendingPayoutError.message }, { status: 500 })
  }
  if (pendingPayout && pendingPayout.length > 0) {
    return NextResponse.json(
      {
        error:
          'You have a payout in progress. Please wait for it to be processed before deleting your account.',
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

  // Deactivate listings — never hard-delete, they may have booking history — and
  // scrub the pickup address, which is the host's own home address and has no
  // remaining transactional value once every booking is in a final state.
  const { error: listingsError } = await admin
    .from('listings')
    .update({ is_active: false, street_address: null })
    .eq('host_id', uid)
  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 })
  }

  // Null the delivery address the user typed at checkout. The eligibility gate above
  // guarantees every remaining booking is completed or cancelled, so no in-flight
  // delivery depends on it — the bookings themselves stay untouched, this only clears
  // one PII column on rows that belong to the deleting user.
  const { error: deliveryAddressError } = await admin
    .from('bookings')
    .update({ delivery_address: null })
    .eq('renter_id', uid)
  if (deliveryAddressError) {
    return NextResponse.json({ error: deliveryAddressError.message }, { status: 500 })
  }

  // Capture verification doc storage paths before deleting the row
  const { data: verifications, error: verificationsReadError } = await admin
    .from('verification_requests')
    .select('id_doc_path, selfie_path')
    .eq('user_id', uid)
  if (verificationsReadError) {
    return NextResponse.json({ error: verificationsReadError.message }, { status: 500 })
  }

  // Storage cleanup runs BEFORE the row deletes below, so a failure here can never
  // orphan files whose only record of their path was verification_requests. Both
  // blocks are non-fatal by design: a storage hiccup must not block the auth
  // soft-delete (the step that actually ends the account), and leaving the rows in
  // place means a retry can still find and remove the files.
  // The message-images bucket is deliberately NOT cleaned up here — those images are
  // part of the counterparty's retained conversation history, same reasoning as
  // leaving messages rows untouched.

  // Storage cleanup: avatars (list, since avatar_url is a public URL not a stored path).
  // Explicit limit: uploadAvatar writes a new timestamped path each time rather than
  // overwriting, so the default 100 could miss files for a heavy avatar-changer.
  const { data: avatarFiles, error: avatarListError } = await admin.storage
    .from('avatars')
    .list(uid, { limit: 1000 })
  if (avatarListError) {
    console.error('[account-delete] avatar storage list failed', avatarListError)
  } else if (avatarFiles && avatarFiles.length > 0) {
    const { error: avatarRemoveError } = await admin.storage
      .from('avatars')
      .remove(avatarFiles.map((f) => `${uid}/${f.name}`))
    if (avatarRemoveError) {
      console.error('[account-delete] avatar storage remove failed', avatarRemoveError)
    }
  }

  // Storage cleanup: verification docs (paths captured above, exact stored paths)
  const docPaths = (verifications ?? [])
    .flatMap((v) => [v.id_doc_path, v.selfie_path])
    .filter((p): p is string => Boolean(p))
  if (docPaths.length > 0) {
    const { error: docRemoveError } = await admin.storage.from('verification-docs').remove(docPaths)
    if (docRemoveError) {
      console.error('[account-delete] verification-docs storage remove failed', docRemoveError)
    }
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

  // Last step: soft-delete the auth user. shouldSoftDelete=true keeps the
  // auth.users row (blocks login only) so profiles.id's FK never cascades.
  const { error: authError } = await admin.auth.admin.deleteUser(uid, true)
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
