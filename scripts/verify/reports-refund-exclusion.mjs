// Proves /admin/reports' commission figures exclude a REFUNDED booking because
// of the payment_status filter, independently of the cancelled filter.
//
// Why this script exists: AGENTS.md records this as proven "by code, not by a
// discriminating row" — paidBookings() filters `payment_status = 'paid'` AND
// `status <> 'cancelled'`, and the database's only refunded booking
// (RNT-75715D) is ALSO cancelled, so it would be excluded either way and live
// data cannot tell the two filters apart.
//
// This builds the discriminating case: a booking that is refunded but
// deliberately NOT cancelled. If the payment_status filter were missing or
// wrong, the figures would not move when it is refunded.
//
// Usage: node --experimental-strip-types scripts/verify/reports-refund-exclusion.mjs [appUrl]
import { URL as SUPABASE_URL, ANON, SECRET, admin, signIn } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'

let fails = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) fails++
}
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
async function signInFull(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json)}`)
  return json
}
function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) =>
    `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`
  ).join('; ')
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
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })

/** Read the Earned / Collected cards straight off the rendered page. */
async function commissionFigures(cookie) {
  const res = await fetch(`${APP}/admin/reports`, { headers: { Cookie: cookie } })
  if (res.status !== 200) throw new Error(`/admin/reports -> ${res.status}`)
  const html = await res.text()
  const grab = (label) => {
    const i = html.indexOf(`>${label}</p>`)
    if (i === -1) throw new Error(`label ${label} not found`)
    const m = html.slice(i).match(/₱([\d,]+)/)
    return m ? Number(m[1].replace(/,/g, '')) : null
  }
  return { earned: grab('Earned'), collected: grab('Collected'), uncollected: grab('Uncollected') }
}

const stamp = Date.now()
const hostEmail = `probe-refund-host-${stamp}@example.com`
const renterEmail = `probe-refund-renter-${stamp}@example.com`
const hostId = await createUser(hostEmail)
const renterId = await createUser(renterEmail)
let listingId = null
let bookingId = null

try {
  const adminCookie = cookieHeaderFor(await signInFull('demo@demo.rentivo.ph', 'DemoRentivo1'))

  const base = await commissionFigures(adminCookie)
  check('baseline figures read off the real page', base.earned !== null && base.collected !== null,
    JSON.stringify(base))

  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Refund Host' }),
  })
  const { body: [listing] } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'R1',
      title: 'Probe refund-exclusion listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
    }),
  })
  listingId = listing.id

  const renterTok = await signIn(renterEmail, 'ProbeRentivo1')
  const created = await rpc(renterTok, 'create_booking', {
    p_listing_id: listingId, p_pickup_date: '2029-06-10', p_return_date: '2029-06-12',
    p_is_delivery: false, p_delivery_address: null, p_payment_method: 'card', p_promo_code: null,
  })
  if (created.status !== 200) throw new Error('create_booking: ' + JSON.stringify(created.body))
  bookingId = created.body.id
  const fee = created.body.service_fee
  check('probe booking has a non-zero service fee', fee > 0, `₱${fee}`)

  await rpc(SECRET, 'mark_booking_paid', { p_booking_id: bookingId, p_paymongo_ref: 'pi_probe_refund' })
  const paid = await commissionFigures(adminCookie)
  check('paid booking RAISES Earned by exactly its service fee',
    paid.earned === base.earned + fee, `${base.earned} -> ${paid.earned} (fee ₱${fee})`)
  check('and raises Collected too (card is a PayMongo method)',
    paid.collected === base.collected + fee, `${base.collected} -> ${paid.collected}`)

  // The discriminating step: refund WITHOUT cancelling.
  const refunded = await rpc(SECRET, 'mark_booking_refunded', { p_booking_id: bookingId, p_refund_ref: 're_probe' })
  check('mark_booking_refunded -> 200', refunded.status === 200, `${refunded.status}`)
  const { body: [row] } = await admin(`bookings?select=status,payment_status&id=eq.${bookingId}`)
  check('booking is refunded but deliberately NOT cancelled',
    row.payment_status === 'refunded' && row.status !== 'cancelled', JSON.stringify(row))

  const after = await commissionFigures(adminCookie)
  check('refunded booking is EXCLUDED from Earned — the payment_status filter, not the cancelled one',
    after.earned === base.earned, `${after.earned} vs baseline ${base.earned}`)
  check('and excluded from Collected', after.collected === base.collected,
    `${after.collected} vs baseline ${base.collected}`)
} finally {
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
  await deleteUser(hostId)
  await deleteUser(renterId)

  const { body: forbidden } = await admin(`profiles?select=id&id=eq.${FORBIDDEN_HOST}`)
  check('forbidden real host untouched', forbidden.length === 1)
  const { body: bookingsLeft } = await admin('bookings?select=id')
  check('booking count back to 17', bookingsLeft.length === 17, `${bookingsLeft.length}`)

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
  process.exit(fails === 0 ? 0 : 1)
}
