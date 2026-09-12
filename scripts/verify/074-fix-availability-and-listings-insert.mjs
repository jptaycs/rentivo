// Verifies migration 074, which fixes two gaps in migration 073 found by
// .superpowers/sdd/2026-09-13-retire-host-qr-and-billing/security-fix-review.md:
//
//   CRITICAL  073's availability policy required reason = 'manual' only,
//             breaking the wizard's real reason: 'personal' insert
//             (ListingWizard.tsx:170) and making the 4 live 'personal' rows
//             undeletable by their own host.
//   IMPORTANT 073 revoked UPDATE on listings but left INSERT wide open,
//             so a host could still forge rating/review_count/view_count
//             at create time.
//
// This script exercises exactly the gaps the review named:
//   - the wizard's real 'personal' shape (not just 'manual')
//   - a booked -> manual relabel-then-delete attempt, proven refused
//   - a single UPDATE touching ALL 22 granted listings columns at once
//     (073's own script only touched 4 — the breadth gap that let the
//     INSERT hole ship unnoticed)
//   - a forged-rating INSERT, refused, with a control proving a legitimate
//     insert still works
//
// Every forbidden attempt has a paired CONTROL. Denials are checked against
// the correct oracle: "permission denied" in the body for grant-based
// denials, vs. a 2xx response affecting 0 rows (plus an independent
// service-role re-read) for RLS-based denials — these are different
// failure modes and only the right one proves the fix works.
//
// All probing runs on a throwaway account created and destroyed by this
// script. The two real demo/forbidden accounts are never written to.
//
// Usage: node scripts/verify/074-fix-availability-and-listings-insert.mjs
import { URL as SUPABASE_URL, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  return j.id
}
const deleteUser = (id) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })

const baseline = async () => ({
  listings: (await admin('listings?select=id')).body.length,
  availability_blocks: (await admin('availability_blocks?select=id')).body.length,
})

const before = await baseline()
const stamp = Date.now()
const hostEmail = `probe-074-host-${stamp}@example.com`
const strangerEmail = `probe-074-stranger-${stamp}@example.com`

const hostId = await createUser(hostEmail)
const strangerId = await createUser(strangerEmail)
let listingId = null
let secondListingId = null

try {
  // ── forbidden-resource sanity: read-only, never written ────────────────
  const { body: [forbiddenHostBefore] } = await admin(
    `profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`
  )
  const { body: [forbiddenBookingBefore] } = await admin(
    `bookings?select=id,updated_at&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`
  )

  // ── setup ────────────────────────────────────────────────────────────
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 074 Host' }),
  })
  const hostTok = await signIn(hostEmail, 'ProbeRentivo1')
  const strangerTok = await signIn(strangerEmail, 'ProbeRentivo1')

  // ══════════════════════════════════════════════════════════════════════
  // IMPORTANT — listings INSERT: forged rating/review_count/view_count
  // ══════════════════════════════════════════════════════════════════════

  // The exact ListingWizard.tsx `fields` shape (host_id + 21 more columns),
  // with the three forgeable fields appended the way a hand-crafted PATCH
  // to the REST API would (the wizard's own UI never sends these — this is
  // the attack the review found, not app behavior).
  const wizardFields = (overrides = {}) => ({
    host_id: hostId,
    category: 'mirrorless',
    brand: 'Probe',
    model: '074',
    title: 'Probe 074 listing',
    description: 'probe listing for migration 074 verification',
    condition: 'good',
    daily_price: 1200,
    weekly_price: 7000,
    monthly_price: 25000,
    security_deposit: 500,
    delivery_fee: null,
    city: 'Manila',
    province: 'Metro Manila',
    street_address: '123 Probe St.',
    is_instant_book: false,
    latitude: 14.5995,
    longitude: 120.9842,
    location_is_exact: false,
    images: [],
    accessories: ['strap'],
    ...overrides,
  })

  const forgeInsert = await asUser(hostTok, 'listings?select=id', {
    method: 'POST',
    body: JSON.stringify(wizardFields({ rating: 5.0, review_count: 999, view_count: 12345 })),
  })
  check('host CANNOT insert a listing with forged rating/review_count/view_count',
    [401, 403].includes(forgeInsert.status) &&
      JSON.stringify(forgeInsert.body).toLowerCase().includes('permission denied'),
    `${forgeInsert.status} ${JSON.stringify(forgeInsert.body)}`)

  // CONTROL: the exact wizard shape, with no forged columns, still creates
  // a real listing.
  const legitInsert = await asUser(hostTok, 'listings?select=id', {
    method: 'POST',
    body: JSON.stringify(wizardFields()),
  })
  check('CONTROL: host CAN insert a listing with the real wizard field set',
    legitInsert.status < 300 && legitInsert.body?.[0]?.id,
    `${legitInsert.status} ${JSON.stringify(legitInsert.body)}`)
  listingId = legitInsert.body?.[0]?.id ?? null

  if (listingId) {
    const { body: [created] } = await admin(
      `listings?select=rating,review_count,view_count,daily_price,title,is_active,is_draft&id=eq.${listingId}`
    )
    check('newly created listing has no forged rating/review_count/view_count (defaults applied)',
      created.rating === null && created.review_count === 0 && created.view_count === 0,
      JSON.stringify(created))
    check('newly created listing got is_active/is_draft defaults untouched by the client',
      created.is_active === true && created.is_draft === false,
      JSON.stringify(created))
  }

  // Cross-host laundering at INSERT time: RLS's WITH CHECK (auth.uid() =
  // host_id) must still refuse this regardless of the column grant.
  const launderInsert = await asUser(hostTok, 'listings?select=id', {
    method: 'POST',
    body: JSON.stringify(wizardFields({ host_id: strangerId })),
  })
  check('host CANNOT insert a listing with host_id set to another user (RLS WITH CHECK)',
    ![200, 201].includes(launderInsert.status),
    `${launderInsert.status} ${JSON.stringify(launderInsert.body)}`)

  // ══════════════════════════════════════════════════════════════════════
  // Breadth control — one UPDATE touching ALL 22 granted listings columns,
  // not 4 of 22 (073's own script's stated gap).
  // ══════════════════════════════════════════════════════════════════════
  if (listingId) {
    const fullUpdate = {
      host_id: hostId,
      category: 'dslr',
      brand: 'Probe Updated',
      model: '074-v2',
      title: 'Probe 074 listing (fully edited)',
      description: 'updated description covering every granted column',
      condition: 'excellent',
      daily_price: 1500,
      weekly_price: 8000,
      monthly_price: 27000,
      security_deposit: 750,
      delivery_fee: 200,
      city: 'Quezon City',
      province: 'Metro Manila',
      street_address: '456 Probe Ave.',
      is_instant_book: true,
      latitude: 14.676,
      longitude: 121.0437,
      location_is_exact: true,
      images: ['https://example.com/probe.jpg'],
      accessories: ['strap', 'case'],
      is_active: false,
    }
    const breadthUpdate = await asUser(hostTok, `listings?id=eq.${listingId}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify(fullUpdate),
    })
    check('CONTROL: host CAN update all 22 granted columns in a single PATCH',
      breadthUpdate.status < 300, `${breadthUpdate.status} ${JSON.stringify(breadthUpdate.body)}`)

    const { body: [afterBreadth] } = await admin(
      `listings?select=${Object.keys(fullUpdate).join(',')}&id=eq.${listingId}`
    )
    const mismatches = Object.entries(fullUpdate).filter(([k, v]) => {
      if (Array.isArray(v)) return JSON.stringify(afterBreadth[k]) !== JSON.stringify(v)
      return afterBreadth[k] !== v
    })
    check('all 22 granted columns actually persisted the new values',
      mismatches.length === 0, JSON.stringify(mismatches))

    // Re-affirm the forged columns are still refused even via this broader
    // PATCH (not just the narrower one 073's own script used).
    const forgeUpdate = await asUser(hostTok, `listings?id=eq.${listingId}&select=id`, {
      method: 'PATCH',
      body: JSON.stringify({ ...fullUpdate, rating: 4.9, review_count: 50, view_count: 999 }),
    })
    check('host still CANNOT forge rating/review_count/view_count via a broad PATCH',
      [401, 403].includes(forgeUpdate.status) &&
        JSON.stringify(forgeUpdate.body).toLowerCase().includes('permission denied'),
      `${forgeUpdate.status} ${JSON.stringify(forgeUpdate.body)}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // CRITICAL — availability_blocks: the wizard's real 'personal' shape
  // ══════════════════════════════════════════════════════════════════════
  if (listingId) {
    const PERSONAL_DATE = '2031-07-01'
    const MANUAL_DATE = '2031-07-02'
    const BOOKED_DATE = '2031-07-03'
    const NULL_REASON_DATE = '2031-07-04'

    // The exact shape ListingWizard.tsx:169-170 inserts.
    const wizardInsert = await asUser(hostTok, 'availability_blocks?select=id', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, blocked_on: PERSONAL_DATE, reason: 'personal' }),
    })
    check("host CAN insert a wizard-shaped reason:'personal' block",
      wizardInsert.status < 300, `${wizardInsert.status} ${JSON.stringify(wizardInsert.body)}`)

    const deletePersonal = await asUser(
      hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${PERSONAL_DATE}`,
      { method: 'DELETE' }
    )
    const deletedPersonalRows = Array.isArray(deletePersonal.body) ? deletePersonal.body.length : null
    check("host CAN delete their own reason:'personal' block (the live-breakage this migration repairs)",
      deletePersonal.status < 300 && deletedPersonalRows === 1,
      `${deletePersonal.status} rows=${deletedPersonalRows}`)

    const { body: personalGone } = await admin(
      `availability_blocks?select=id&listing_id=eq.${listingId}&blocked_on=eq.${PERSONAL_DATE}`
    )
    check("'personal' block actually gone", personalGone.length === 0)

    // useAvailabilityBlocks.ts:68's own shape still works too.
    const manualInsert = await asUser(hostTok, 'availability_blocks?select=id', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, blocked_on: MANUAL_DATE, reason: 'manual' }),
    })
    check("CONTROL: host CAN insert a reason:'manual' block",
      manualInsert.status < 300, `${manualInsert.status} ${JSON.stringify(manualInsert.body)}`)

    const deleteManual = await asUser(
      hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${MANUAL_DATE}`,
      { method: 'DELETE' }
    )
    const deletedManualRows = Array.isArray(deleteManual.body) ? deleteManual.body.length : null
    check("CONTROL: host CAN delete their own reason:'manual' block",
      deleteManual.status < 300 && deletedManualRows === 1,
      `${deleteManual.status} rows=${deletedManualRows}`)

    // A NULL-reason row (any pre-existing row that predates both labels)
    // must also stay host-writable — this is the whole reason for
    // "is distinct from", not "<>".
    const nullInsert = await asUser(hostTok, 'availability_blocks?select=id', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, blocked_on: NULL_REASON_DATE, reason: null }),
    })
    check('host CAN insert a NULL-reason block (NULL-safety of "is distinct from")',
      nullInsert.status < 300, `${nullInsert.status} ${JSON.stringify(nullInsert.body)}`)

    const deleteNull = await asUser(
      hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${NULL_REASON_DATE}`,
      { method: 'DELETE' }
    )
    const deletedNullRows = Array.isArray(deleteNull.body) ? deleteNull.body.length : null
    check('host CAN delete their own NULL-reason block',
      deleteNull.status < 300 && deletedNullRows === 1,
      `${deleteNull.status} rows=${deletedNullRows}`)

    // ── booked -> manual relabel-then-delete, proven refused ────────────
    await admin('availability_blocks', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, blocked_on: BOOKED_DATE, reason: 'booked' }),
    })

    const relabelAttempt = await asUser(
      hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`,
      { method: 'PATCH', body: JSON.stringify({ reason: 'manual' }) }
    )
    const relabeledRows = Array.isArray(relabelAttempt.body) ? relabelAttempt.body.length : null
    check("host CANNOT relabel a 'booked' row to 'manual' (USING excludes it from UPDATE entirely)",
      relabelAttempt.status < 300 && relabeledRows === 0,
      `${relabelAttempt.status} rows=${relabeledRows}`)

    const { body: [afterRelabelAttempt] } = await admin(
      `availability_blocks?select=reason&listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`
    )
    check("'booked' row's reason unchanged after the relabel attempt",
      afterRelabelAttempt.reason === 'booked', JSON.stringify(afterRelabelAttempt))

    // Since the relabel never took, a follow-on delete attempt (the actual
    // "relabel-then-delete" sidestep) is also refused, on the ORIGINAL
    // 'booked' predicate — proving the sidestep has no path through even if
    // the relabel step is attempted in isolation immediately before it.
    const deleteAfterRelabelAttempt = await asUser(
      hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`,
      { method: 'DELETE' }
    )
    const deletedAfterRelabelRows = Array.isArray(deleteAfterRelabelAttempt.body)
      ? deleteAfterRelabelAttempt.body.length : null
    check("the relabel-then-delete sidestep is refused end-to-end (0 rows deleted)",
      deleteAfterRelabelAttempt.status < 300 && deletedAfterRelabelRows === 0,
      `${deleteAfterRelabelAttempt.status} rows=${deletedAfterRelabelRows}`)

    const { body: bookedStillThere } = await admin(
      `availability_blocks?select=id&listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`
    )
    check("'booked' row still present after the full relabel-then-delete attempt",
      bookedStillThere.length === 1)

    // Direct delete of the 'booked' row (no relabel step) is refused too —
    // re-affirming MEDIUM-2 from 073 still holds under the widened policy.
    const directDeleteBooked = await asUser(
      hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`,
      { method: 'DELETE' }
    )
    const directDeletedRows = Array.isArray(directDeleteBooked.body) ? directDeleteBooked.body.length : null
    check("host still CANNOT directly delete a 'booked' row",
      directDeleteBooked.status < 300 && directDeletedRows === 0,
      `${directDeleteBooked.status} rows=${directDeletedRows}`)

    // cleanup the 'booked' probe row via service role (not the app writing it)
    await admin(`availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`, { method: 'DELETE' })

    // ── cross-host: a stranger cannot touch this host's listing's blocks ──
    const strangerInsertAttempt = await asUser(strangerTok, 'availability_blocks?select=id', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, blocked_on: '2031-07-05', reason: 'manual' }),
    })
    check('a stranger CANNOT insert a block on another host\'s listing',
      ![200, 201].includes(strangerInsertAttempt.status),
      `${strangerInsertAttempt.status} ${JSON.stringify(strangerInsertAttempt.body)}`)
  }

  // ── proof the fix repairs the 4 real live 'personal' rows: the widened
  // policy expression matches reason='personal' structurally (already
  // exercised above with a probe row of our own); independently confirm no
  // real 'personal' row was touched by this run.
  const { body: realPersonalRows } = await admin(
    `availability_blocks?select=id,listing_id&reason=eq.personal`
  )
  check('real live \'personal\' rows still present (none deleted by this run)',
    realPersonalRows.length >= 4, `count=${realPersonalRows.length}`)

  // ── forbidden resources still untouched ─────────────────────────────────
  const { body: [forbiddenHostAfter] } = await admin(
    `profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`
  )
  const { body: [forbiddenBookingAfter] } = await admin(
    `bookings?select=id,updated_at&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`
  )
  check('forbidden host untouched',
    forbiddenHostBefore?.updated_at === forbiddenHostAfter?.updated_at)
  check('forbidden booking untouched',
    forbiddenBookingBefore?.updated_at === forbiddenBookingAfter?.updated_at)
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────
  for (const id of [listingId, secondListingId]) {
    if (id) {
      await admin(`availability_blocks?listing_id=eq.${id}`, { method: 'DELETE' })
      await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
    }
  }
  await deleteUser(hostId)
  await deleteUser(strangerId)
}

const after = await baseline()
check('baseline restored: listings', after.listings === before.listings, `${before.listings} -> ${after.listings}`)
check('baseline restored: availability_blocks', after.availability_blocks === before.availability_blocks,
  `${before.availability_blocks} -> ${after.availability_blocks}`)

done()
