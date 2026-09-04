// Whole-feature end-to-end verification for exact-pickup-coordinates
// (065 location_is_exact + generated approx_*, 067 get_listing_coordinates).
//
// This is deliberately the one script that drives the feature the way a real
// host/renter would: the listing is INSERTED through the HOST's own session
// (mirroring ListingWizard.tsx's real insert shape — latitude/longitude/
// location_is_exact: true — not an admin-client shortcut), and the booking is
// walked pending -> confirmed through the HOST's own session so the real
// enforce_booking_transition trigger approves the hop rather than being
// bypassed by the service role (auth.uid() null short-circuits it).
//
// The pending-then-confirmed pair uses the SAME renter and SAME booking on
// purpose: without that CONTROL, a refusal on the pending booking could be
// blamed on any unrelated guard rather than proven to be the booking-status
// check inside get_listing_coordinates itself.
//
// Account-deletion resetting a listing to the city centre and clearing
// location_is_exact is Task 9's own concern and is already covered by
// scripts/verify/069-account-deletion-coordinates.mjs (needs a dev server on
// :3100) — not duplicated here.
//
// Usage: node --experimental-strip-types scripts/verify/exact-coordinates-e2e.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '../../src/lib/listing-columns.ts'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

// A real Manila-area point. Rounding to 2dp shifts a point by at most ~775m
// (per 065's own comment) — that's the whole privacy mechanism, and the
// point below is chosen for realism, not to dodge that bound.
const PLACED = { lat: 14.5995123, lng: 120.9842456 }

function haversineMetres(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

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
const hostEmail = `probe-e2e-coords-host-${stamp}@example.com`
const renterEmail = `probe-e2e-coords-renter-${stamp}@example.com`
const strangerEmail = `probe-e2e-coords-stranger-${stamp}@example.com`

const hostId = await createUser(hostEmail)
const renterId = await createUser(renterEmail)
const strangerId = await createUser(strangerEmail)
let listingId = null
let bookingId = null

try {
  // ── storefront regression, run BEFORE the probe listing exists ──────────
  // Task 7 widened LISTING_COLUMNS to include the approx_* columns, which is
  // exactly what can blank the storefront if a grant is missing — an !inner
  // embed the caller cannot read returns ZERO parent rows, not an error, so
  // this must be asserted explicitly. Checked against the real baseline (23
  // active, non-draft listings) before the probe listing below would inflate
  // it by one.
  {
    const storefrontSelect = `${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey!inner(${PROFILE_COLUMNS})`
    const storefrontRes = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?select=${encodeURIComponent(storefrontSelect)}&is_active=eq.true&is_draft=eq.false`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
    )
    const storefrontBody = await storefrontRes.json()
    check('storefront !inner join still returns rows',
      storefrontRes.status === 200 && storefrontBody.length === 23,
      `${storefrontRes.status} ${storefrontBody.length}`)
  }

  // ── setup ──────────────────────────────────────────────────────────────
  // is_verified so migration 037's trigger doesn't force the listing to
  // draft (which would make the storefront/RLS checks below meaningless).
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe E2E Coords Host' }),
  })
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe E2E Coords Renter' }),
  })
  await admin(`profiles?id=eq.${strangerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe E2E Coords Stranger' }),
  })

  const hostTok = await signIn(hostEmail, 'ProbeRentivo1')
  const renterTok = await signIn(renterEmail, 'ProbeRentivo1')
  const strangerTok = await signIn(strangerEmail, 'ProbeRentivo1')

  // ── the host places the pin, through their own session, exactly the way
  // ListingWizard.tsx's real insert does (latitude/longitude/location_is_exact
  // all in the one insert body) ─────────────────────────────────────────────
  // select=id only: 064 revoked table-level SELECT on `listings`, so an
  // insert asking PostgREST to echo back the full row (the default
  // Prefer: return=representation) would 403 on columns like latitude that
  // the host has no SELECT grant on, even though the INSERT itself succeeds.
  // `id` is one of 064's granted columns, so this mirrors what the real
  // ListingWizard insert relies on.
  const insertRes = await asUser(hostTok, 'listings?select=id', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'E2E',
      title: 'Probe e2e coordinates listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
      latitude: PLACED.lat, longitude: PLACED.lng, location_is_exact: true,
    }),
  })
  if (insertRes.status !== 201 || !insertRes.body?.[0]) {
    throw new Error(`listing insert failed: ${insertRes.status} ${JSON.stringify(insertRes.body)}`)
  }
  listingId = insertRes.body[0].id

  // Re-read with the service role — the point of this check is what got
  // STORED, not what the host's own RLS-scoped insert echoed back.
  const { body: [row] } = await admin(`listings?select=latitude,longitude,location_is_exact&id=eq.${listingId}`)
  check('host-placed pin stored verbatim',
    Number(row.latitude) === PLACED.lat && Number(row.longitude) === PLACED.lng,
    `${row.latitude}, ${row.longitude}`)
  check('placing a pin marks the listing exact', row.location_is_exact === true)

  // ── anon reads the coarsened public view ─────────────────────────────────
  const pub = await asUser(null, `listings?select=id,approx_latitude,approx_longitude,location_is_exact&id=eq.${listingId}`)
  check('anon reads approx_*', pub.status === 200 && pub.body?.[0]?.approx_latitude != null,
    `${pub.status} ${JSON.stringify(pub.body)}`)

  const shift = haversineMetres(PLACED, {
    lat: Number(pub.body[0].approx_latitude),
    lng: Number(pub.body[0].approx_longitude),
  })
  check('published point is coarsened, not exact', shift > 0, `${shift.toFixed(0)}m`)
  check('published point stays within the 1km circle', shift <= 1000, `${shift.toFixed(0)}m`)

  // ── anon cannot reach the exact columns or the RPC ──────────────────────
  const anonExact = await asUser(null, `listings?select=latitude,longitude&id=eq.${listingId}`)
  check('anon refused the exact columns', anonExact.status === 401 || anonExact.status === 403, `${anonExact.status}`)

  const anonRpc = await rpc(null, 'get_listing_coordinates', { p_listing_id: listingId })
  check('anon refused the RPC', [401, 403, 404].includes(anonRpc.status), `${anonRpc.status}`)

  // ── an unrelated signed-in user gets nothing from the RPC ───────────────
  const stranger = await rpc(strangerTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('signed-in stranger refused the RPC',
    stranger.status === 200 && stranger.body?.length === 0,
    `${stranger.status} ${JSON.stringify(stranger.body)}`)

  // ── the load-bearing pair: same renter, same booking, pending vs confirmed
  const createdBooking = await rpc(renterTok, 'create_booking', {
    p_listing_id: listingId, p_pickup_date: '2029-07-10', p_return_date: '2029-07-12',
    p_is_delivery: false, p_delivery_address: null, p_payment_method: 'card', p_promo_code: null,
  })
  if (createdBooking.status !== 200) throw new Error('create_booking: ' + JSON.stringify(createdBooking.body))
  bookingId = createdBooking.body.id
  check('setup: booking created pending', createdBooking.body.status === 'pending', createdBooking.body.status)

  const pending = await rpc(renterTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('renter with a PENDING booking gets nothing',
    pending.status === 200 && pending.body?.length === 0,
    `${pending.status} ${JSON.stringify(pending.body)}`)

  const confirm = await asUser(hostTok, `bookings?id=eq.${bookingId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }),
  })
  check('host confirms the booking', confirm.status === 200, `${confirm.status} ${JSON.stringify(confirm.body).slice(0, 100)}`)

  const confirmed = await rpc(renterTok, 'get_listing_coordinates', { p_listing_id: listingId })
  check('CONTROL: same renter after confirmation gets the exact point',
    confirmed.status === 200 && confirmed.body?.length === 1 && Number(confirmed.body[0].latitude) === PLACED.lat,
    `${confirmed.status} ${JSON.stringify(confirmed.body)}`)
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
