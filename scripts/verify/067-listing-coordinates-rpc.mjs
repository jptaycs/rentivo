// Verifies get_listing_coordinates (067) — the only path to a listing's
// exact latitude/longitude now that 064 revoked table-level SELECT on
// `listings` and 065 made latitude/longitude private columns.
//
// Entitled callers: the listing's host, and a renter whose booking has
// reached `confirmed` (or later). A `pending` booking must get nothing —
// an unpaid, unaccepted request must not reveal where the host lives.
//
// Throwaway host + renter + listing + booking, following the setup shape
// in scripts/verify/020-mark-payout-failed.mjs: real sessions for every
// authorisation claim, service role only for setup/re-reads/cleanup, and
// the booking is walked to `confirmed` through the HOST's own session so
// the enforce_booking_transition trigger really approves the hop rather
// than being bypassed by the service role (auth.uid() null short-circuits
// it, per 004's enforce_booking_transition()).
//
// Usage: node --experimental-strip-types scripts/verify/067-listing-coordinates-rpc.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

const PLACED_LAT = 14.5995123
const PLACED_LON = 120.9842456

const rpc = async (tok, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${tok ?? ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

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
  bookings: (await admin('bookings?select=id')).body.length,
  listings: (await admin('listings?select=id')).body.length,
  profiles: (await admin('profiles?select=id')).body.length,
})

const before = await baseline()
const stamp = Date.now()
const hostEmail = `probe-coords-host-${stamp}@example.com`
const renterEmail = `probe-coords-renter-${stamp}@example.com`
const strangerEmail = `probe-coords-stranger-${stamp}@example.com`

const hostId = await createUser(hostEmail)
const renterId = await createUser(renterEmail)
const strangerId = await createUser(strangerEmail)
let listingId = null
let bookingId = null

try {
  // ── setup ──────────────────────────────────────────────────────────────
  // is_verified so migration 037's trigger doesn't force the listing to draft.
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Coords Host' }),
  })
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe Coords Renter' }),
  })
  await admin(`profiles?id=eq.${strangerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe Coords Stranger' }),
  })

  const { body: [listing] } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'C1',
      title: 'Probe coordinates listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
      latitude: PLACED_LAT, longitude: PLACED_LON, location_is_exact: true,
    }),
  })
  listingId = listing.id
  check('setup: probe listing carries the placed coordinates',
    Number(listing.latitude) === PLACED_LAT && Number(listing.longitude) === PLACED_LON,
    `${listing.latitude}, ${listing.longitude}`)

  const hostTok = await signIn(hostEmail, 'ProbeRentivo1')
  const renterTok = await signIn(renterEmail, 'ProbeRentivo1')
  const strangerTok = await signIn(strangerEmail, 'ProbeRentivo1')

  // ── host: entitled immediately, no booking needed ────────────────────────
  const hostRes = await rpc(hostTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('host gets their own exact coordinates',
    hostRes.status === 200 && hostRes.body?.length === 1 && Number(hostRes.body[0].latitude) === PLACED_LAT,
    `${hostRes.status} ${JSON.stringify(hostRes.body)}`)

  // ── renter creates a booking (pending, unpaid by default) ───────────────
  const created = await rpc(renterTok, 'create_booking', {
    p_listing_id: listingId, p_pickup_date: '2029-06-10', p_return_date: '2029-06-12',
    p_is_delivery: false, p_delivery_address: null, p_payment_method: 'card', p_promo_code: null,
  })
  if (created.status !== 200) throw new Error('create_booking: ' + JSON.stringify(created.body))
  bookingId = created.body.id
  check('setup: booking created pending', created.body.status === 'pending', created.body.status)

  // ── the pair that matters most: same renter, pending vs. confirmed ──────
  const pendingRes = await rpc(renterTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('renter with a PENDING booking gets nothing',
    pendingRes.status === 200 && pendingRes.body?.length === 0,
    `${pendingRes.status} ${JSON.stringify(pendingRes.body)}`)

  // Walk to confirmed through the HOST's own session, so the transition
  // trigger really approves the hop (service role would bypass it).
  const confirm = await asUser(hostTok, `bookings?id=eq.${bookingId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }),
  })
  check('host confirms the booking', confirm.status === 200, `${confirm.status} ${JSON.stringify(confirm.body).slice(0, 100)}`)

  const confirmedRes = await rpc(renterTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('SAME renter with a CONFIRMED booking gets the exact point',
    confirmedRes.status === 200 && confirmedRes.body?.length === 1 && Number(confirmedRes.body[0].latitude) === PLACED_LAT,
    `${confirmedRes.status} ${JSON.stringify(confirmedRes.body)}`)

  // ── unrelated signed-in user ─────────────────────────────────────────────
  const strangerRes = await rpc(strangerTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('unrelated signed-in user gets nothing',
    strangerRes.status === 200 && strangerRes.body?.length === 0,
    `${strangerRes.status} ${JSON.stringify(strangerRes.body)}`)

  // ── anon cannot execute the RPC at all ───────────────────────────────────
  const anonRes = await rpc(null, 'get_listing_coordinates', { p_listing_id: listingId })
  check('anon cannot execute the RPC at all', [401, 403, 404].includes(anonRes.status), `${anonRes.status}`)

  // ── exact coordinates still unreadable from the table directly ──────────
  // Even the entitled host cannot read latitude/longitude off the table —
  // 064 revoked table-level SELECT and 065's grant list excludes them, so
  // the RPC (security definer) is the ONLY path, by design.
  const tableRes = await asUser(hostTok, `listings?id=eq.${listingId}&select=latitude,longitude`)
  check('exact coordinates still unreadable from the table',
    tableRes.status === 401 || tableRes.status === 403, `${tableRes.status} ${JSON.stringify(tableRes.body).slice(0, 100)}`)
} finally {
  // ── cleanup, in FK order ──────────────────────────────────────────────
  if (bookingId) {
    await admin(`availability_blocks?booking_id=eq.${bookingId}`, { method: 'DELETE' })
    const { body: convs } = await admin(`conversations?select=id&booking_id=eq.${bookingId}`)
    for (const c of convs ?? []) await admin(`messages?conversation_id=eq.${c.id}`, { method: 'DELETE' })
    await admin(`conversations?booking_id=eq.${bookingId}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${bookingId}`, { method: 'DELETE' })
  }
  if (listingId) await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${hostId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${renterId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${strangerId}`, { method: 'DELETE' })
  await deleteUser(hostId)
  await deleteUser(renterId)
  await deleteUser(strangerId)

  const after = await baseline()
  const same = Object.keys(before).every((k) => before[k] === after[k])
  check('baseline restored', same, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)

  const { body: forbidden } = await admin(`profiles?select=id,suspended_at&id=eq.${FORBIDDEN_HOST}`)
  check('forbidden real host untouched', forbidden.length === 1 && forbidden[0].suspended_at === null)
  const { body: forbiddenBooking } = await admin(`bookings?select=id,status,booking_ref&booking_ref=eq.${FORBIDDEN_BOOKING_CODE}`)
  check('forbidden real booking untouched', forbiddenBooking.length === 1)

  done()
}
