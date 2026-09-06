// Sets up (and tears down) the data for the renter pickup-location UI check:
// a throwaway host with a PLACED pin well away from the city centre, a second
// listing left on the backfilled city centre, and a renter with a confirmed
// booking on each. Prints the renter's credentials so a browser pass can drive
// the real page.
//
// Usage:
//   node --experimental-strip-types scripts/verify/renter-pickup-location.mjs setup
//   node --experimental-strip-types scripts/verify/renter-pickup-location.mjs teardown
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn } from './env.mjs'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

const STATE = '/tmp/renter-pickup-state.json'
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const mode = process.argv[2] ?? 'setup'

const rpc = async (tok, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: tok === SECRET ? SECRET : ANON,
      Authorization: `Bearer ${tok ?? ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const createUser = async (email) => {
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
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })

if (mode === 'teardown') {
  if (!existsSync(STATE)) { console.log('nothing to tear down'); process.exit(0) }
  const st = JSON.parse(readFileSync(STATE, 'utf8'))
  for (const id of st.bookingIds ?? []) {
    await admin(`availability_blocks?booking_id=eq.${id}`, { method: 'DELETE' })
    const { body: convs } = await admin(`conversations?select=id&booking_id=eq.${id}`)
    for (const c of convs ?? []) await admin(`messages?conversation_id=eq.${c.id}`, { method: 'DELETE' })
    await admin(`conversations?booking_id=eq.${id}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of st.listingIds ?? []) await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${st.hostId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${st.renterId}`, { method: 'DELETE' })
  await deleteUser(st.hostId)
  await deleteUser(st.renterId)
  unlinkSync(STATE)
  const { body: left } = await admin('listings?select=id')
  const { body: fh } = await admin(`profiles?select=id&id=eq.${FORBIDDEN_HOST}`)
  console.log(`torn down. listings: ${left.length} (expect 25); forbidden host intact: ${fh.length === 1}`)
  process.exit(0)
}

const stamp = Date.now()
const hostEmail = `probe-pickup-host-${stamp}@example.com`
const renterEmail = `probe-pickup-renter-${stamp}@example.com`
const hostId = await createUser(hostEmail)
const renterId = await createUser(renterEmail)

await admin(`profiles?id=eq.${hostId}`, {
  method: 'PATCH',
  body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Pickup Host' }),
})

// Manila's city centre is 14.5904,120.9804 (the backfill value). The placed pin
// is deliberately ~3km away so "the map is at the placed point" is provable
// rather than coincidental.
const PLACED = { lat: 14.6205, lng: 121.0101 }
const mkListing = async (title, exact) => {
  const { body: [l] } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'PX',
      title, description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
      latitude: exact ? PLACED.lat : 14.5904,
      longitude: exact ? PLACED.lng : 120.9804,
      location_is_exact: exact,
    }),
  })
  return l.id
}
const placedId = await mkListing('Probe PLACED pin listing', true)
const backfilledId = await mkListing('Probe BACKFILLED listing', false)

const renterTok = await signIn(renterEmail, 'ProbeRentivo1')
const hostTok = await signIn(hostEmail, 'ProbeRentivo1')
const bookingIds = []
const book = async (listingId, from, to, confirm) => {
  const r = await rpc(renterTok, 'create_booking', {
    p_listing_id: listingId, p_pickup_date: from, p_return_date: to,
    p_is_delivery: false, p_delivery_address: null, p_payment_method: 'card', p_promo_code: null,
  })
  if (r.status !== 200) throw new Error('create_booking: ' + JSON.stringify(r.body))
  bookingIds.push(r.body.id)
  await rpc(SECRET, 'mark_booking_paid', { p_booking_id: r.body.id, p_paymongo_ref: 'pi_probe_pickup' })
  if (confirm) {
    // Through the HOST's own session so enforce_booking_transition really approves it.
    await asUser(hostTok, `bookings?id=eq.${r.body.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) })
  }
  return r.body.id
}
const confirmedPlaced = await book(placedId, '2029-08-10', '2029-08-12', true)
const confirmedBackfilled = await book(backfilledId, '2029-08-20', '2029-08-22', true)
const pendingPlaced = await book(placedId, '2029-09-10', '2029-09-12', false)

writeFileSync(STATE, JSON.stringify({
  hostId, renterId, listingIds: [placedId, backfilledId], bookingIds,
  renterEmail, placed: PLACED, confirmedPlaced, confirmedBackfilled, pendingPlaced,
}, null, 2))

console.log('renter email :', renterEmail)
console.log('password     : ProbeRentivo1')
console.log('placed pin   :', PLACED.lat, PLACED.lng, '(city centre is 14.5904 120.9804)')
console.log('bookings     : confirmed+placed, confirmed+backfilled, pending+placed')
