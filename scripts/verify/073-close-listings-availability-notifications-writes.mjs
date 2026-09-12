// Verifies migration 073: closes three table-level write holes proven live
// by the 2026-09-13 security audit
// (.superpowers/sdd/2026-09-13-retire-host-qr-and-billing/security-audit.md).
//
//   HIGH-1   a host could forge their own listing's rating/review_count/view_count
//   MEDIUM-2 a host could delete a 'booked' availability_blocks row, freeing
//            dates a renter already paid for
//   LOW-5    a user could rewrite the title/body/type/link of their own
//            notification (only is_read should be writable)
//
// Every forbidden attempt below has a paired CONTROL proving the identical
// call succeeds when it should — a bare "it was denied" proves nothing about
// WHY. All probing runs on a throwaway account created and destroyed by this
// script; the two real demo/forbidden accounts are never written to.
//
// Usage: node scripts/verify/073-close-listings-availability-notifications-writes.mjs
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
  notifications: (await admin('notifications?select=id')).body.length,
})

const before = await baseline()
const stamp = Date.now()
const hostEmail = `probe-073-host-${stamp}@example.com`

const hostId = await createUser(hostEmail)
let listingId = null
let notifId = null

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
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 073 Host' }),
  })
  const hostTok = await signIn(hostEmail, 'ProbeRentivo1')

  const { body: [listing] } = await admin('listings?select=id', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: '073',
      title: 'Probe 073 listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
      rating: null, review_count: 0, view_count: 0,
      latitude: 14.5995, longitude: 120.9842, location_is_exact: false,
    }),
  })
  listingId = listing.id

  // ── HIGH-1: listings.rating / review_count / view_count ────────────────
  // select=id on every PATCH below: 064 revoked table-level SELECT on
  // listings and granted only a specific column list, so PostgREST's
  // default Prefer: return=representation (no explicit ?select=) would try
  // to echo back every column and 403 on the SELECT half regardless of
  // whether the UPDATE itself was permitted — that would make a forbidden
  // attempt "fail" for the wrong reason and a legitimate one fail for a
  // reason unrelated to what's under test. Pinning `select=id` (a granted
  // column) isolates the check to the UPDATE privilege alone.
  const forgeAttempt = await asUser(hostTok, `listings?id=eq.${listingId}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ rating: 5.0, review_count: 999, view_count: 12345 }),
  })
  check('host CANNOT forge rating/review_count/view_count',
    [401, 403].includes(forgeAttempt.status) &&
      JSON.stringify(forgeAttempt.body).toLowerCase().includes('permission denied'),
    `${forgeAttempt.status} ${JSON.stringify(forgeAttempt.body)}`)

  const { body: [afterForge] } = await admin(
    `listings?select=rating,review_count,view_count&id=eq.${listingId}`
  )
  check('rating/review_count/view_count unchanged after the forbidden attempt',
    afterForge.rating === null && afterForge.review_count === 0 && afterForge.view_count === 0,
    JSON.stringify(afterForge))

  // CONTROL: the host's own legitimate edit fields still save.
  const legitEdit = await asUser(hostTok, `listings?id=eq.${listingId}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({
      daily_price: 1500, title: 'Probe 073 listing (edited)',
      description: 'updated description', is_active: false,
    }),
  })
  check('CONTROL: host CAN update price/title/description/is_active',
    legitEdit.status < 300, `${legitEdit.status} ${JSON.stringify(legitEdit.body)}`)

  const { body: [afterEdit] } = await admin(
    `listings?select=daily_price,title,description,is_active&id=eq.${listingId}`
  )
  check('CONTROL: legitimate edit actually persisted',
    afterEdit.daily_price === 1500 &&
      afterEdit.title === 'Probe 073 listing (edited)' &&
      afterEdit.description === 'updated description' &&
      afterEdit.is_active === false,
    JSON.stringify(afterEdit))

  // ── MEDIUM-2: availability_blocks reason='booked' vs 'manual' ──────────
  const BOOKED_DATE = '2031-06-15'
  const MANUAL_DATE = '2031-06-16'

  await admin('availability_blocks', {
    method: 'POST',
    body: JSON.stringify({ listing_id: listingId, blocked_on: BOOKED_DATE, reason: 'booked' }),
  })

  const deleteBooked = await asUser(
    hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`,
    { method: 'DELETE' }
  )
  const deletedBookedRows = Array.isArray(deleteBooked.body) ? deleteBooked.body.length : null
  check("host CANNOT delete a reason='booked' row",
    deleteBooked.status < 300 && deletedBookedRows === 0,
    `${deleteBooked.status} rows=${deletedBookedRows}`)

  const { body: bookedStillThere } = await admin(
    `availability_blocks?select=id&listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`
  )
  check("'booked' row still present after the forbidden attempt", bookedStillThere.length === 1)

  // CONTROL: the host can still insert and delete their own manual block —
  // the exact reason:'manual' shape src/hooks/useAvailabilityBlocks.ts:68 inserts.
  const insertManual = await asUser(hostTok, 'availability_blocks', {
    method: 'POST',
    body: JSON.stringify({ listing_id: listingId, blocked_on: MANUAL_DATE, reason: 'manual' }),
  })
  check('CONTROL: host CAN insert a manual block',
    insertManual.status < 300, `${insertManual.status} ${JSON.stringify(insertManual.body)}`)

  const deleteManual = await asUser(
    hostTok, `availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${MANUAL_DATE}`,
    { method: 'DELETE' }
  )
  const deletedManualRows = Array.isArray(deleteManual.body) ? deleteManual.body.length : null
  check('CONTROL: host CAN delete their own manual block',
    deleteManual.status < 300 && deletedManualRows === 1,
    `${deleteManual.status} rows=${deletedManualRows}`)

  const { body: manualGone } = await admin(
    `availability_blocks?select=id&listing_id=eq.${listingId}&blocked_on=eq.${MANUAL_DATE}`
  )
  check('manual block actually gone', manualGone.length === 0)

  // cleanup the 'booked' probe row now (service role — this is not the app writing it)
  await admin(`availability_blocks?listing_id=eq.${listingId}&blocked_on=eq.${BOOKED_DATE}`, { method: 'DELETE' })

  // ── LOW-5: notifications ────────────────────────────────────────────────
  const { body: [notif] } = await admin('notifications', {
    method: 'POST',
    body: JSON.stringify({
      user_id: hostId, type: 'booking_request',
      title: 'Original title', body: 'Original body', is_read: false,
    }),
  })
  notifId = notif.id

  const rewriteAttempt = await asUser(hostTok, `notifications?id=eq.${notifId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'HACKED', body: 'HACKED', type: 'review_received', link: '/evil' }),
  })
  check('user CANNOT rewrite title/body/type/link of their own notification',
    [401, 403].includes(rewriteAttempt.status) &&
      JSON.stringify(rewriteAttempt.body).toLowerCase().includes('permission denied'),
    `${rewriteAttempt.status} ${JSON.stringify(rewriteAttempt.body)}`)

  const { body: [afterRewrite] } = await admin(
    `notifications?select=title,body,type,link&id=eq.${notifId}`
  )
  check('notification content unchanged after the forbidden attempt',
    afterRewrite.title === 'Original title' &&
      afterRewrite.body === 'Original body' &&
      afterRewrite.type === 'booking_request' &&
      afterRewrite.link === null,
    JSON.stringify(afterRewrite))

  // CONTROL: is_read stays writable.
  const flipRead = await asUser(hostTok, `notifications?id=eq.${notifId}`, {
    method: 'PATCH', body: JSON.stringify({ is_read: true }),
  })
  check('CONTROL: user CAN flip is_read',
    flipRead.status < 300, `${flipRead.status} ${JSON.stringify(flipRead.body)}`)

  const { body: [afterFlip] } = await admin(`notifications?select=is_read&id=eq.${notifId}`)
  check('CONTROL: is_read actually persisted', afterFlip.is_read === true)

  // ── increment_listing_view is security definer — unaffected ────────────
  // The RPC's own WHERE clause requires is_active = true (011), and the
  // CONTROL edit above deliberately set is_active = false to prove that
  // field is writable — reactivate first so this section tests the RPC,
  // not that unrelated precondition.
  await admin(`listings?id=eq.${listingId}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) })
  const { body: [beforeView] } = await admin(`listings?select=view_count&id=eq.${listingId}`)
  const viewCall = await asUser(null, 'rpc/increment_listing_view', {
    method: 'POST', body: JSON.stringify({ p_listing_id: listingId }),
  })
  check('increment_listing_view still succeeds for anon',
    viewCall.status < 300, `${viewCall.status} ${JSON.stringify(viewCall.body)}`)
  const { body: [afterView] } = await admin(`listings?select=view_count&id=eq.${listingId}`)
  check('increment_listing_view actually incremented view_count',
    afterView.view_count === beforeView.view_count + 1,
    `${beforeView.view_count} -> ${afterView.view_count}`)

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
  if (notifId) await admin(`notifications?id=eq.${notifId}`, { method: 'DELETE' })
  if (listingId) {
    await admin(`availability_blocks?listing_id=eq.${listingId}`, { method: 'DELETE' })
    await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  }
  await admin(`notifications?user_id=eq.${hostId}`, { method: 'DELETE' })
  await deleteUser(hostId)
}

const after = await baseline()
check('baseline restored: listings', after.listings === before.listings, `${before.listings} -> ${after.listings}`)
check('baseline restored: availability_blocks', after.availability_blocks === before.availability_blocks,
  `${before.availability_blocks} -> ${after.availability_blocks}`)
check('baseline restored: notifications', after.notifications === before.notifications,
  `${before.notifications} -> ${after.notifications}`)

done()
