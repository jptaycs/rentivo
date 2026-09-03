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
 *
 * Three eligibility gates block deletion: an in-flight booking, a pending
 * payout request, and — as of host commission billing (061) — an `issued`
 * (unpaid) `host_bills` row. `host_bills`/`host_bill_items` are themselves
 * deliberately LEFT UNTOUCHED by deletion once eligible: they are financial
 * records referencing only `host_id` (no PII), same reasoning as leaving
 * `conversations`/`messages` untouched below — but unlike those, a *paid* or
 * *void* bill for a deleted host is exactly the kind of record deletion must
 * not erase, since it is Rentivo's own revenue ledger, not the user's data.
 */

/**
 * What is blocking a deletion.
 *
 * ⚠️ No field is an assurance of absence. The three gates below are
 * deliberately not short-circuited, and a query that FAILED contributes nothing
 * rather than being read as "no blockers" — so:
 *   • `pendingPayouts: 0` alongside a non-empty `bookings` (or `issuedBills`)
 *     may mean the payout query errored, i.e. "not checked", NOT "none pending".
 *   • `bookings: []` alongside `pendingPayouts > 0` or `issuedBills > 0` may
 *     likewise mean the bookings query errored.
 *   • `issuedBills: 0` alongside either other field non-empty may mean the
 *     host_bills query errored.
 *   • ALL THREE empty on an `ok: false` means the check could not be performed
 *     at all (see EligibilityResult).
 * Do not render any value as a positive statement ("no pending payouts") in
 * a UI. Render only what is non-empty.
 */
export interface DeletionBlocker {
  bookings: string[]
  pendingPayouts: number
  issuedBills: number
}

/**
 * `ok: false` with a NON-EMPTY blocker = genuinely blocked; `reason` is copy a
 * caller may show, and the caller should return 400.
 *
 * `ok: false` with an EMPTY blocker (no bookings AND `pendingPayouts: 0` AND
 * `issuedBills: 0`) = the check could not be performed — a malformed uid, or a
 * failed query. `reason` is then a raw diagnostic, not user-facing copy, and
 * the caller should return 500. It never means "nothing is blocking".
 */
export type EligibilityResult =
  | { ok: true }
  | { ok: false; reason: string; blocking: DeletionBlocker }

/** Same shape as src/lib/hosts.ts — kept identical rather than reinvented. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The three eligibility gates. Returns the blocking booking refs, the
 * pending-payout count, and the issued-bill count so a caller can *show* what
 * is blocking rather than only saying that something is.
 *
 * The `reason` strings are admin-facing and phrased in the third person — the
 * self-service route maps them to its own second-person wording so what a real
 * user sees is unchanged.
 *
 * A **blocked** result always carries a non-empty blocker (a booking ref, a
 * payout count > 0, or an issued-bill count > 0). An `ok: false` with an EMPTY
 * blocker therefore means the check could not be performed at all — a
 * malformed uid, or a failed query — and `reason` is then a raw diagnostic,
 * not copy to show a user. Callers should surface that case as a 500, not as
 * a 400.
 *
 * Reporting order is deliberate, not incidental: an issued bill is checked
 * (and reported) FIRST, ahead of bookings and payouts, because it is the gate
 * an admin can clear fastest (void the bill) and the one a caller's own
 * wording is keyed to.
 */
export async function checkDeletionEligibility(uid: string): Promise<EligibilityResult> {
  // Shape-check the uid HERE rather than trusting every caller to do it. The
  // bookings gate below interpolates it straight into a PostgREST `.or()` filter,
  // which is filter grammar, not a bound parameter — an admin route passing a raw
  // URL path segment would otherwise reach it unvalidated. This module is the one
  // place that obligation gets discharged (see the header comment); a
  // "remember to validate in each caller" rule is precisely the failure mode this
  // repo has already recorded twice (038 resurrecting a grant 007 revoked, and
  // 004's column grants sitting decorative). Returns rather than throws, so the
  // callers' error semantics are unchanged.
  if (!UUID_RE.test(uid)) {
    return {
      ok: false,
      reason: 'Invalid user id.',
      blocking: { bookings: [], pendingPayouts: 0, issuedBills: 0 },
    }
  }

  const admin = createAdminClient()

  // Eligibility gate: block while any booking isn't in a final state
  const { data: blocking, error: blockingError } = await admin
    .from('bookings')
    .select('booking_ref')
    .or(`renter_id.eq.${uid},host_id.eq.${uid}`)
    .in('status', ['pending', 'confirmed', 'active'])

  // Eligibility gate: block while a payout request is still pending. Disbursement is
  // manual — an admin reads payout_accounts.account_number/account_name to send the
  // money — so scrubbing those fields now would strand real owed money with no way
  // for the (locked-out) host to restore it.
  //
  // Deliberately NOT short-circuited on the gate above: the admin UI reports
  // everything blocking a deletion at once, which a short-circuit would prevent.
  const { data: pendingPayout, error: payoutError } = await admin
    .from('payout_requests')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'pending')

  // Eligibility gate: an issued (unpaid) commission bill is real money owed to
  // Rentivo (host commission billing, 061). Deleting would forgive it. Paid and
  // void bills do not block. Bills and items are LEFT UNTOUCHED on deletion:
  // financial records referencing only host_id, no PII.
  const { data: issuedBills, error: billError } = await admin
    .from('host_bills')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'issued')

  // A query that failed tells us nothing, so it contributes nothing — it must not
  // be read as "no blockers". The real blockers found by whichever query DID
  // succeed are reported first below; only if none found anything do we fall
  // through to reporting the failure itself, so a broken query can never be
  // mistaken for an eligible account. Consequence worth knowing: if bookings block
  // AND the payout (or bill) query failed, the reported `pendingPayouts: 0` (or
  // `issuedBills: 0`) means "unknown", not "none" — deletion is blocked either
  // way, which is the safe direction.
  const refs = blockingError ? [] : (blocking ?? []).map((b) => b.booking_ref as string)
  const payouts = payoutError ? 0 : (pendingPayout ?? []).length
  const bills = billError ? 0 : (issuedBills ?? []).length

  // Bills reported FIRST: it's the gate an admin can clear fastest (void), and
  // the one whose wording callers key their message-matching on.
  if (bills > 0) {
    return {
      ok: false,
      reason: 'This account has an unpaid commission bill. It must be paid or voided first.',
      blocking: { bookings: refs, pendingPayouts: payouts, issuedBills: bills },
    }
  }
  if (refs.length > 0) {
    return {
      ok: false,
      reason: 'This account has an active booking. It must complete or be cancelled first.',
      blocking: { bookings: refs, pendingPayouts: payouts, issuedBills: bills },
    }
  }
  if (payouts > 0) {
    return {
      ok: false,
      reason: 'This account has a payout in progress. It must be processed first.',
      blocking: { bookings: [], pendingPayouts: payouts, issuedBills: bills },
    }
  }
  if (blockingError) {
    return {
      ok: false,
      reason: blockingError.message,
      blocking: { bookings: [], pendingPayouts: 0, issuedBills: 0 },
    }
  }
  if (payoutError) {
    return {
      ok: false,
      reason: payoutError.message,
      blocking: { bookings: [], pendingPayouts: 0, issuedBills: 0 },
    }
  }
  if (billError) {
    return {
      ok: false,
      reason: billError.message,
      blocking: { bookings: [], pendingPayouts: 0, issuedBills: 0 },
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
  //
  // `conversations` (pre-booking inquiries, migrations 049-056) is likewise
  // deliberately LEFT UNTOUCHED, not purged or anonymized. It holds
  // renter_id/host_id like bookings/messages/reviews and has no `on delete
  // cascade` from profiles, but a conversation thread is the counterparty's
  // retained history exactly like `messages` — the same reasoning as the
  // paragraph above, not an omission. Nothing is exercised by this today:
  // deletion soft-deletes the auth user and anonymizes (never hard-deletes)
  // `profiles`, so the clause-less FK is never hit. Recorded explicitly per
  // AGENTS.md's standing obligation so a future reader finds a decision here,
  // not a gap.
  //
  // `host_bills`/`host_bill_items` (host commission billing, 061) are
  // deliberately LEFT UNTOUCHED here too — by the time this function runs,
  // checkDeletionEligibility has already guaranteed no `issued` bill exists
  // for this host, so only `paid`/`void` rows can remain. Those are Rentivo's
  // own revenue ledger (they reference only `host_id`, carry no PII), and a
  // deleted host's past commission history must stay auditable — unlike
  // `conversations`/`messages`, this is not "the counterparty's history", it's
  // Rentivo's own, so there is no PII reason to purge or anonymize it.

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
