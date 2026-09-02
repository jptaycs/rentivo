import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Shared account-deletion logic, called by BOTH the self-service route
 * (src/app/api/account/delete/route.ts) and the admin route
 * (src/app/api/admin/users/[id]/delete/route.ts).
 *
 * ⚠️ STANDING OBLIGATION (AGENTS.md): any new table, any new PII column on
 * `profiles`, and any new storage bucket must be added to the purge/anonymize
 * lists below. This module exists so that obligation has exactly ONE place to
 * discharge — do not copy this logic into a second caller.
 *
 * Deletion is deliberately NOT a hard delete: bookings/reviews/messages
 * reference profiles without `on delete cascade`, while profiles.id -> auth.users
 * DOES cascade, so a real auth delete would wipe the counterparty's history.
 */

export interface DeletionBlocker {
  bookings: string[]
  pendingPayouts: number
}

export type EligibilityResult =
  | { ok: true }
  | { ok: false; reason: string; blocking: DeletionBlocker }

/**
 * The two eligibility gates. Returns the blocking booking refs and the
 * pending-payout count so a caller can *show* what is blocking rather than
 * only saying that something is.
 *
 * The `reason` strings are admin-facing and phrased in the third person — the
 * self-service route maps them to its own second-person wording so what a real
 * user sees is unchanged.
 */
export async function checkDeletionEligibility(uid: string): Promise<EligibilityResult> {
  const admin = createAdminClient()

  // Eligibility gate: block while any booking isn't in a final state
  const { data: blocking, error: blockingError } = await admin
    .from('bookings')
    .select('booking_ref')
    .or(`renter_id.eq.${uid},host_id.eq.${uid}`)
    .in('status', ['pending', 'confirmed', 'active'])
  if (blockingError) {
    return {
      ok: false,
      reason: blockingError.message,
      blocking: { bookings: [], pendingPayouts: 0 },
    }
  }

  // Eligibility gate: block while a payout request is still pending. Disbursement is
  // manual — an admin reads payout_accounts.account_number/account_name to send the
  // money — so scrubbing those fields now would strand real owed money with no way
  // for the (locked-out) host to restore it.
  const { data: pendingPayout, error: payoutError } = await admin
    .from('payout_requests')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'pending')
  if (payoutError) {
    return {
      ok: false,
      reason: payoutError.message,
      blocking: { bookings: [], pendingPayouts: 0 },
    }
  }

  const refs = (blocking ?? []).map((b) => b.booking_ref as string)
  const payouts = (pendingPayout ?? []).length

  if (refs.length > 0) {
    return {
      ok: false,
      reason: 'This account has an active booking. It must complete or be cancelled first.',
      blocking: { bookings: refs, pendingPayouts: payouts },
    }
  }
  if (payouts > 0) {
    return {
      ok: false,
      reason: 'This account has a payout in progress. It must be processed first.',
      blocking: { bookings: [], pendingPayouts: payouts },
    }
  }
  return { ok: true }
}

/**
 * Everything after the gates. Callers must run checkDeletionEligibility first —
 * this function does not re-check it.
 */
export async function deleteAccount(uid: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()

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
      // Host payment QR (028): qr_payment_label is the host's real name + mobile
      // number, qr_payment_url the storage path whose file is removed below.
      qr_payment_url: null,
      qr_payment_label: null,
    })
    .eq('id', uid)
  if (profileError) {
    return { ok: false, error: profileError.message }
  }

  // Deactivate listings — never hard-delete, they may have booking history — and
  // scrub the pickup address, which is the host's own home address and has no
  // remaining transactional value once every booking is in a final state.
  const { error: listingsError } = await admin
    .from('listings')
    .update({ is_active: false, street_address: null })
    .eq('host_id', uid)
  if (listingsError) {
    return { ok: false, error: listingsError.message }
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
    return { ok: false, error: deliveryAddressError.message }
  }

  // Capture verification doc storage paths before deleting the row
  const { data: verifications, error: verificationsReadError } = await admin
    .from('verification_requests')
    .select('id_doc_path, selfie_path')
    .eq('user_id', uid)
  if (verificationsReadError) {
    return { ok: false, error: verificationsReadError.message }
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

  // Storage cleanup: host payment QR codes (028). Listed rather than read from
  // profiles.qr_payment_url, since the anonymize above already nulled that column —
  // uploads are <uid>/<uuid>.<ext>, and useProfile.uploadQrCode writes a new
  // uuid path each time, so the folder can legitimately hold more than one file.
  // Non-fatal, exactly like the avatars block above: a storage hiccup must never
  // block the auth soft-delete.
  const { data: qrFiles, error: qrListError } = await admin.storage
    .from('payment-qr-codes')
    .list(uid, { limit: 1000 })
  if (qrListError) {
    console.error('[account-delete] payment-qr-codes storage list failed', qrListError)
  } else if (qrFiles && qrFiles.length > 0) {
    const { error: qrRemoveError } = await admin.storage
      .from('payment-qr-codes')
      .remove(qrFiles.map((f) => `${uid}/${f.name}`))
    if (qrRemoveError) {
      console.error('[account-delete] payment-qr-codes storage remove failed', qrRemoveError)
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
    return { ok: false, error: `Failed to clean up payout_accounts: ${payoutAccountError.message}` }
  }

  // Delete sensitive/disposable rows — no counterparty depends on any of these
  for (const table of ['verification_requests', 'notifications', 'wishlist', 'recently_viewed_listings'] as const) {
    const { error } = await admin.from(table).delete().eq('user_id', uid)
    if (error) {
      return { ok: false, error: `Failed to clean up ${table}: ${error.message}` }
    }
  }

  // Last step: soft-delete the auth user. shouldSoftDelete=true keeps the
  // auth.users row (blocks login only) so profiles.id's FK never cascades.
  const { error: authError } = await admin.auth.admin.deleteUser(uid, true)
  if (authError) {
    return { ok: false, error: authError.message }
  }

  return { ok: true }
}
