// Verifies the checkout route refuses a PayMongo method listed in
// NEXT_PUBLIC_DISABLED_PAYMENT_METHODS by name, before any booking row exists,
// and that the enabled method (qrph) still goes through. Run against a dev
// server: `node scripts/verify/checkout-disabled-method.mjs http://localhost:3100`
import { URL as SUPABASE_URL, ANON, admin } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }

async function signInFull(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
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
  const parts = []
  for (let i = 0; i * CHUNK < value.length; i++) parts.push(`${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  return parts.join('; ')
}

const session = await signInFull('renter@demo.rentivo.ph', 'DemoRentivo1')
const cookie = cookieHeaderFor(session)
const renterId = session.user.id

// A live listing the renter doesn't own, with no fee surprises.
const { body: listings } = await admin(`listings?select=id,title,host_id&is_active=eq.true&is_draft=eq.false&host_id=neq.${renterId}&limit=1`)
const listing = listings[0]
if (!listing) throw new Error('no usable listing')
// Far-future dates so no availability block interferes.
const pickupDate = '2027-03-10', returnDate = '2027-03-12'

const before = (await admin(`bookings?select=id&renter_id=eq.${renterId}`)).body.length

async function checkout(method) {
  const res = await fetch(`${APP}/api/payments/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ listingId: listing.id, pickupDate, returnDate, isDelivery: false, method }),
  })
  return { status: res.status, body: await res.json() }
}

for (const m of ['gcash', 'maya', 'card']) {
  const r = await checkout(m)
  check(`${m} -> 400`, r.status === 400, `got ${r.status}`)
  check(`${m} message names the method`, typeof r.body.error === 'string' && r.body.error.startsWith(m === 'card' ? 'Credit / Debit Card' : m === 'gcash' ? 'GCash' : 'Maya'), JSON.stringify(r.body.error))
  check(`${m} message names QR Ph as the alternative`, /pay with QR Ph instead/.test(r.body.error ?? ''))
  check(`${m} returns no bookingId`, r.body.bookingId === undefined)
}
const mid = (await admin(`bookings?select=id&renter_id=eq.${renterId}`)).body.length
check('no booking row created by the three refusals', mid === before, `${before} -> ${mid}`)

// Control: the enabled method still reaches PayMongo (test keys) and creates a booking.
const ok = await checkout('qrph')
check('qrph control -> 200', ok.status === 200, `got ${ok.status} ${JSON.stringify(ok.body).slice(0, 120)}`)
check('qrph control returns status "qr" with an image', ok.body.status === 'qr' && typeof ok.body.qrImage === 'string')
if (ok.body.bookingId) {
  const del = await admin(`bookings?id=eq.${ok.body.bookingId}`, { method: 'DELETE' })
  check('control booking deleted', del.status === 200 && del.body.length === 1)
}
const after = (await admin(`bookings?select=id&renter_id=eq.${renterId}`)).body.length
check('booking count back at baseline', after === before, `${before} -> ${after}`)
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
