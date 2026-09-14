import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCityCoordinates } from '@/lib/ph-locations'

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
 * Three eligibility gates block deletion: an in-flight booking, a draft
 * payout statement, and money Rentivo still owes the host. A fourth gate — an
 * `issued` (unpaid) `host_bills` row, from the host commission billing system
 * (061) — existed here until that system was retired 2026-09-13 (see
 * .superpowers/sdd/2026-09-13-retire-host-qr-and-billing/) alongside the
 * `host_qr` payment method it existed to bill: once QR Ph activation let
 * Rentivo collect its fee directly at the point of sale, there was nothing
 * left to bill, so nothing further could ever land in `issued` status and the
 * gate had no future use. Migration 072 dropped `host_bills`/`host_bill_items`
 * outright — this module never wrote to them and, now that the tables are
 * gone, cannot read them either.
 *
 * The owed-money gate (082, admin-issued payout statements): once the account
 * is scrubbed the admin has nowhere left to send the money, and the deleted
 * host can no longer see that they're owed it. A **suspended** host with a
 * balance can be neither paid (`create_payout_statement` refuses a suspended
 * host) nor deleted — deliberately, so that decision is a person's (reinstate,
 * or write the balance off some other way), not a side effect of deletion.
 *
 * `payout_requests`' `account_name`/`account_number` snapshot columns (082)
 * are PII and are anonymized in place by `deleteAccount` (so is
 * `reversal_reason`, admin free text that usually quotes the account), same reasoning as
 * `payout_accounts` below — the rows are the platform's financial record of
 * money actually paid (or a cancelled/reversed attempt) and `payout_items`
 * points at them, so the rows themselves survive; only the account identity
 * on them is scrubbed. `payout_statement_counters` and `platform_settings`
 * hold no personal data and are correctly left untouched.
 */

/**
 * What is blocking a deletion.
 *
 * ⚠️ No field is an assurance of absence. The three gates below are
 * deliberately not short-circuited, and a query that FAILED contributes nothing
 * rather than being read as "no blockers" — so:
 *   • `pendingPayouts: 0` alongside a non-empty `bookings` may mean the
 *     payout query errored, i.e. "not checked", NOT "none pending".
 *   • `bookings: []` alongside `pendingPayouts > 0` may likewise mean the
 *     bookings query errored.
 *   • `owedAmount: 0` may mean the `payouts_owed` RPC errored, i.e. "not
 *     checked", NOT "nothing owed" — same rule as the other two fields.
 *   • ALL THREE empty/zero on an `ok: false` means the check could not be
 *     performed at all (see EligibilityResult).
 * Do not render any value as a positive statement ("no pending payouts") in
 * a UI. Render only what is non-empty.
 */
export interface DeletionBlocker {
  bookings: string[]
  pendingPayouts: number
  owedAmount: number
}

/**
 * `ok: false` with a NON-EMPTY blocker = genuinely blocked; `reason` is copy a
 * caller may show, and the caller should return 400.
 *
 * `ok: false` with an EMPTY blocker (no bookings AND `pendingPayouts: 0`) = the
 * check could not be performed — a malformed uid, or a failed query. `reason`
 * is then a raw diagnostic, not user-facing copy, and the caller should
 * return 500. It never means "nothing is blocking".
 */
export type EligibilityResult =
  | { ok: true }
  | { ok: false; reason: string; blocking: DeletionBlocker }

/** Same shape as src/lib/hosts.ts — kept identical rather than reinvented. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The two eligibility gates. Returns the blocking booking refs and the
 * pending-payout count so a caller can *show* what is blocking rather than
 * only saying that something is.
 *
 * The `reason` strings are admin-facing and phrased in the third person — the
 * self-service route maps them to its own second-person wording so what a real
 * user sees is unchanged.
 *
 * A **blocked** result always carries a non-empty blocker (a booking ref, or a
 * payout count > 0). An `ok: false` with an EMPTY blocker therefore means the
 * check could not be performed at all — a malformed uid, or a failed query —
 * and `reason` is then a raw diagnostic, not copy to show a user. Callers
 * should surface that case as a 500, not as a 400.
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
      blocking: { bookings: [], pendingPayouts: 0, owedAmount: 0 },
    }
  }

  const admin = createAdminClient()

  // Eligibility gate: block while any booking isn't in a final state
  const { data: blocking, error: blockingError } = await admin
    .from('bookings')
    .select('booking_ref')
    .or(`renter_id.eq.${uid},host_id.eq.${uid}`)
    .in('status', ['pending', 'confirmed', 'active'])

  // Eligibility gate: block while a draft payout statement (082) is open.
  // `payout_requests.status = 'pending'` is now a DRAFT statement rather than a
  // host-requested payout — an admin prepares it via create_payout_statement(),
  // snapshotting the payout account onto the row. Disbursement is still manual,
  // so scrubbing the account now would strand a draft with nowhere to send the
  // money and no way for the (locked-out) host to fix it.
  //
  // Deliberately NOT short-circuited on the gate above: the admin UI reports
  // everything blocking a deletion at once, which a short-circuit would prevent.
  const { data: pendingPayout, error: payoutError } = await admin
    .from('payout_requests')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'pending')

  // Eligibility gate: block while Rentivo still owes this host money (082).
  // payouts_owed() is the one definition of what request_payout()'s successor,
  // create_payout_statement(), would pay — once the account is scrubbed the
  // admin has nowhere left to send it, and the host can no longer see they're
  // owed it. A suspended host with a balance can be neither paid (that RPC
  // refuses a suspended host) nor deleted — deliberately, so writing off or
  // resolving the balance is a person's decision, not a side effect of
  // deletion.
  const { data: owedRows, error: owedError } = await admin.rpc('payouts_owed', { p_host_id: uid })

  // A query that failed tells us nothing, so it contributes nothing — it must not
  // be read as "no blockers". The real blockers found by whichever query DID
  // succeed are reported first below; only if none found anything do we fall
  // through to reporting the failure itself, so a broken query can never be
  // mistaken for an eligible account. Consequence worth knowing: if bookings block
  // AND the payout query failed, the reported `pendingPayouts: 0` means
  // "unknown", not "none" — deletion is blocked either way, which is the safe
  // direction. The same holds for `owedAmount: 0` against a failed
  // `payouts_owed` call.
  const refs = blockingError ? [] : (blocking ?? []).map((b) => b.booking_ref as string)
  const payouts = payoutError ? 0 : (pendingPayout ?? []).length
  const owed = owedError ? 0 : ((owedRows?.[0]?.amount as number | undefined) ?? 0)

  if (refs.length > 0) {
    return {
      ok: false,
      reason: 'This account has an active booking. It must complete or be cancelled first.',
      blocking: { bookings: refs, pendingPayouts: payouts, owedAmount: owed },
    }
  }
  if (payouts > 0) {
    return {
      ok: false,
      reason: 'This account has a draft payout statement. It must be recorded or cancelled first.',
      blocking: { bookings: [], pendingPayouts: payouts, owedAmount: owed },
    }
  }
  if (owed > 0) {
    return {
      ok: false,
      reason: `Rentivo still owes this account ₱${owed.toLocaleString('en-PH')}. It must be paid out first.`,
      blocking: { bookings: [], pendingPayouts: 0, owedAmount: owed },
    }
  }
  if (blockingError) {
    return {
      ok: false,
      reason: blockingError.message,
      blocking: { bookings: [], pendingPayouts: 0, owedAmount: 0 },
    }
  }
  if (payoutError) {
    return {
      ok: false,
      reason: payoutError.message,
      blocking: { bookings: [], pendingPayouts: 0, owedAmount: 0 },
    }
  }
  if (owedError) {
    return {
      ok: false,
      reason: owedError.message,
      blocking: { bookings: [], pendingPayouts: 0, owedAmount: 0 },
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

  // Reset exact pickup coordinates (065/066) to the listing's city centre —
  // latitude/longitude are NOT NULL as of 066, so they can't be nulled the way
  // street_address is above. This is the same value a listing had before its
  // host ever placed a pin, and location_is_exact goes back to false so no UI
  // may keep claiming precision for it. Kept in this same block, right after
  // the address scrub above, so a reader finds one place where a host's
  // location is cleared rather than two.
  const { data: ownedListings, error: ownedListingsError } = await admin
    .from('listings')
    .select('id, city, province')
    .eq('host_id', uid)
  if (ownedListingsError) {
    return { ok: false, error: ownedListingsError.message }
  }
  for (const listing of ownedListings ?? []) {
    const { lat, lng } = getCityCoordinates(listing.city ?? '', listing.province ?? '')
    const { error: coordsError } = await admin
      .from('listings')
      .update({ latitude: lat, longitude: lng, location_is_exact: false })
      .eq('id', listing.id)
    if (coordsError) {
      return { ok: false, error: coordsError.message }
    }
  }

  // Null the delivery address the user typed at checkout. The eligibility gate above
  // guarantees every remaining booking is completed or cancelled, so no in-flight
  // delivery depends on it — the bookings themselves stay untouched, this only clears
  // one PII column on rows that belong to the deleting user.
  // The delivery pin (078) goes with it: renter delivery coordinates are personal
  // data — a point on a map is at least as identifying as the typed address.
  const { error: deliveryAddressError } = await admin
    .from('bookings')
    .update({ delivery_address: null, delivery_latitude: null, delivery_longitude: null })
    .eq('renter_id', uid)
  if (deliveryAddressError) {
    return { ok: false, error: deliveryAddressError.message }
  }

  // Free-text booking notes (security audit 2, LOW-7). Decision: ANONYMIZE IN
  // PLACE, one side at a time. Each note column is text the user wrote on THEIR
  // side of the booking — `renter_notes` on rows where they are the renter,
  // `host_notes` on rows where they are the host — so it is theirs and is
  // nulled. The COUNTERPARTY's note on the same row is the counterparty's own
  // record and is deliberately left untouched. The booking rows themselves
  // survive (amounts, dates, refs are the counterparty's history too).
  const { error: renterNotesError } = await admin
    .from('bookings')
    .update({ renter_notes: null })
    .eq('renter_id', uid)
  if (renterNotesError) {
    return { ok: false, error: renterNotesError.message }
  }
  const { error: hostNotesError } = await admin
    .from('bookings')
    .update({ host_notes: null })
    .eq('host_id', uid)
  if (hostNotesError) {
    return { ok: false, error: hostNotesError.message }
  }

  // payout_requests.notes (LOW-7). Decision: ANONYMIZE IN PLACE. The rows must
  // survive — they are the platform's record of money actually paid or failed,
  // and payout_items points at them — so amount/status/reference/timestamps
  // stay. `notes` is free text (an admin's failure reason, often quoting the
  // host's account name or number) about this specific person, with no
  // financial value once the request is settled; the eligibility gate
  // guarantees none is still pending. So it is nulled. `reference` (the
  // disbursement reference) is kept as the money trail.
  // `reversal_reason` (082) is the same kind of admin free text — a reversal is
  // usually explained by the account ("GCash 0917… is closed") — so it is
  // scrubbed too. Placeholder, not null: payout_requests_reversal_shape requires
  // a reason on every reversed row, and the 'Redacted' value still tells a
  // reader the statement WAS reversed for a reason.
  const { error: payoutNotesError } = await admin
    .from('payout_requests')
    .update({ notes: null })
    .eq('host_id', uid)
  if (!payoutNotesError) {
    const { error: reversalReasonError } = await admin
      .from('payout_requests')
      .update({ reversal_reason: 'Redacted' })
      .eq('host_id', uid)
      .not('reversal_reason', 'is', null)
    if (reversalReasonError) {
      return { ok: false, error: `Failed to clean up payout_requests: ${reversalReasonError.message}` }
    }
  }
  if (payoutNotesError) {
    return { ok: false, error: `Failed to clean up payout_requests: ${payoutNotesError.message}` }
  }

  // payout_requests' account snapshot (082). Decision: ANONYMIZE IN PLACE, same
  // reasoning as payout_accounts above — the rows are the platform's record of
  // money actually paid, and payout_items points at them. Statement numbers,
  // amounts, references, transfer dates and every payout_items row are KEPT: that
  // is the financial record. payout_items.listing_title is kept too — the listing
  // row itself is anonymized above, but the snapshot IS the document.
  // payout_statement_counters and platform_settings hold no personal data.
  //
  // One row at a time because the last four digits differ per row — this cannot
  // be a single blanket update. account_name/account_number stay NOT NULL rather
  // than being nulled: payout_requests_paid_complete (082) requires both be
  // non-null on a `paid` row, so a placeholder is what keeps that constraint
  // satisfied for an issued statement.
  const { data: hostPayoutRequests, error: hostPayoutRequestsReadError } = await admin
    .from('payout_requests')
    .select('id, account_number')
    .eq('host_id', uid)
    .not('account_number', 'is', null)
  if (hostPayoutRequestsReadError) {
    return { ok: false, error: `Failed to read payout_requests: ${hostPayoutRequestsReadError.message}` }
  }
  for (const row of hostPayoutRequests ?? []) {
    const accountNumber = row.account_number as string
    const { error: snapshotError } = await admin
      .from('payout_requests')
      .update({ account_name: 'Deleted User', account_number: accountNumber.slice(-4) })
      .eq('id', row.id)
    if (snapshotError) {
      return { ok: false, error: `Failed to anonymize payout_requests snapshot: ${snapshotError.message}` }
    }
  }

  // A deleted host's listings (LOW-7). Decision: ANONYMIZE IN PLACE, and
  // DELETE the photos. The listing row must survive because bookings (and
  // reviews/conversations) reference it, and the counterparty's receipt still
  // needs a row to point at — so it is not deleted. But the title, description
  // and serial number are host-authored free text that can identify the person
  // (and the serial number identifies their physical device), so they are
  // replaced. The listing is already deactivated above, so nothing public shows
  // the placeholder. `images` is cleared and the objects removed below.
  const { error: listingTextError } = await admin
    .from('listings')
    .update({
      title: 'Deleted listing',
      description: '',
      serial_number: null,
      images: [],
    })
    .eq('host_id', uid)
  if (listingTextError) {
    return { ok: false, error: listingTextError.message }
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
  // `host_bills`/`host_bill_items` (host commission billing, 061) no longer
  // exist — migration 072 dropped both tables outright when the billing
  // system was retired 2026-09-13 (see
  // .superpowers/sdd/2026-09-13-retire-host-qr-and-billing/), alongside the
  // `host_qr` payment method they existed to bill. There is nothing left here
  // to purge, anonymize, or gate deletion on; this module never wrote to them
  // and cannot read them now that they're gone.

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

  // Storage cleanup: listing photos. The wizard uploads to `listing-images` at
  // `<uid>/<uuid>.<ext>` (a flat folder), and the listing rows' `images` were
  // cleared above, so nothing references these objects any more. Paginated so a
  // host with many photos is fully cleared. Non-fatal like the blocks around it.
  for (let round = 0; round < 50; round++) {
    const { data: listingFiles, error: listingListError } = await admin.storage
      .from('listing-images')
      .list(uid, { limit: 1000 })
    if (listingListError) {
      console.error('[account-delete] listing-images storage list failed', listingListError)
      break
    }
    const names = (listingFiles ?? []).filter((f) => f.name && f.id !== null).map((f) => `${uid}/${f.name}`)
    if (names.length === 0) break
    const { error: listingRemoveError } = await admin.storage.from('listing-images').remove(names)
    if (listingRemoveError) {
      console.error('[account-delete] listing-images storage remove failed', listingRemoveError)
      break
    }
    if (names.length < 1000) break
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
  // placeholder rather than nulling them. Status goes to `rejected`: the row can
  // no longer receive money, and a `verified` status would let a later reversal
  // of this host's statement offer "Prepare statement" against it
  // (create_payout_statement requires `verified`, so this makes it refuse).
  const { error: payoutAccountError } = await admin
    .from('payout_accounts')
    .update({ account_number: 'DELETED', account_name: 'Deleted User', status: 'rejected' })
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

  // Rate-limit hits (076) embed the user id in `key` as `<scope>:<uid>` — the
  // uid is always the last segment, so an exact-suffix match is precise (a
  // uuid contains no LIKE wildcards). Nobody else depends on these rows.
  const { error: rateLimitError } = await admin.from('rate_limit_hits').delete().like('key', `%:${uid}`)
  if (rateLimitError) {
    return { ok: false, error: `Failed to clean up rate_limit_hits: ${rateLimitError.message}` }
  }

  // Last step: soft-delete the auth user. shouldSoftDelete=true keeps the
  // auth.users row (blocks login only) so profiles.id's FK never cascades.
  const { error: authError } = await admin.auth.admin.deleteUser(uid, true)
  if (authError) {
    return { ok: false, error: authError.message }
  }

  return { ok: true }
}
