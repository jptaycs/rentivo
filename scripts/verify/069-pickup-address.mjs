// Verifies migration 069: the host's street_address now rides along with the
// exact coordinates, behind the SAME gate, and reaches nobody who wasn't
// already entitled to the coordinates.
//
// Every authorisation claim uses a real session; admin() is setup/re-read/cleanup only.
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const ADDRESS = 'Unit 14B, 88 Probe Tower, Barangay Verification'
let fails = 0
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) fails++ }

const rpc = async (tok, args) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_listing_coordinates`, {
    method: 'POST',
    headers: { apikey: tok === SECRET ? SECRET : ANON, Authorization: `Bearer ${tok ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const createUser = async (email) => {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await r.json(); if (!j.id) throw new Error(JSON.stringify(j)); return j.id
}
const deleteUser = (id) => fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
  method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })

const stamp = Date.now()
const hostEmail = `probe-addr-host-${stamp}@example.com`
const renterEmail = `probe-addr-renter-${stamp}@example.com`
const strangerEmail = `probe-addr-stranger-${stamp}@example.com`
const hostId = await createUser(hostEmail)
const renterId = await createUser(renterEmail)
const strangerId = await createUser(strangerEmail)
let listingId = null, bookingId = null

try {
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Addr Host' }) })
  const { body: [listing] } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'AD',
      title: 'Probe address listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Makati', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
      latitude: 14.5547, longitude: 121.0244, location_is_exact: true,
      street_address: ADDRESS,
    }),
  })
  listingId = listing.id

  const hostTok = await signIn(hostEmail, 'ProbeRentivo1')
  const renterTok = await signIn(renterEmail, 'ProbeRentivo1')
  const strangerTok = await signIn(strangerEmail, 'ProbeRentivo1')

  // host always entitled
  const host = await rpc(hostTok, { p_listing_id: listingId })
  check('host gets their own address', host.body?.[0]?.street_address === ADDRESS, JSON.stringify(host.body?.[0]))

  // booking: pending first (the control), then confirmed
  const mk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${renterTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_listing_id: listingId, p_pickup_date: '2029-10-10', p_return_date: '2029-10-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'card', p_promo_code: null }),
  })
  const booking = await mk.json()
  if (!booking?.id) throw new Error('create_booking: ' + JSON.stringify(booking))
  bookingId = booking.id

  const pending = await rpc(renterTok, { p_listing_id: listingId })
  check('renter with a PENDING booking gets nothing', Array.isArray(pending.body) && pending.body.length === 0, JSON.stringify(pending.body))

  await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_booking_paid`, {
    method: 'POST', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_booking_id: bookingId, p_paymongo_ref: 'pi_probe_addr' }),
  })
  // confirm through the HOST's own session so the transition trigger approves it
  await asUser(hostTok, `bookings?id=eq.${bookingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) })

  const confirmed = await rpc(renterTok, { p_listing_id: listingId })
  check('CONTROL: same renter after confirmation gets the address',
    confirmed.body?.[0]?.street_address === ADDRESS, JSON.stringify(confirmed.body?.[0]))
  check('and still gets the exact coordinates', Number(confirmed.body?.[0]?.latitude) === 14.5547)

  const stranger = await rpc(strangerTok, { p_listing_id: listingId })
  check('signed-in stranger with no booking gets nothing', Array.isArray(stranger.body) && stranger.body.length === 0, JSON.stringify(stranger.body))

  const anon = await rpc(null, { p_listing_id: listingId })
  check('anon cannot execute the RPC', [401, 403, 404].includes(anon.status), `${anon.status}`)

  // the address must not be reachable off the table by anyone
  const tbl = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=street_address&id=eq.${listingId}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${renterTok}` } })
  check('street_address still unreadable from the table, even for the entitled renter', tbl.status === 401 || tbl.status === 403, `${tbl.status}`)
} finally {
  if (bookingId) {
    await admin(`availability_blocks?booking_id=eq.${bookingId}`, { method: 'DELETE' })
    const { body: convs } = await admin(`conversations?select=id&booking_id=eq.${bookingId}`)
    for (const c of convs ?? []) await admin(`messages?conversation_id=eq.${c.id}`, { method: 'DELETE' })
    await admin(`conversations?booking_id=eq.${bookingId}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${bookingId}`, { method: 'DELETE' })
  }
  if (listingId) await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  for (const id of [hostId, renterId, strangerId]) {
    await admin(`notifications?user_id=eq.${id}`, { method: 'DELETE' })
    await deleteUser(id)
  }
  const { body: left } = await admin('listings?select=id')
  const { body: fh } = await admin(`profiles?select=id,suspended_at&id=eq.${FORBIDDEN_HOST}`)
  check('baseline restored (25 listings)', left.length === 25, `${left.length}`)
  check('forbidden host untouched', fh.length === 1 && fh[0].suspended_at === null)
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
  process.exit(fails === 0 ? 0 : 1)
}
