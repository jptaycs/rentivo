// Task B6 (spec/plan 2026-09-14): proves two independent things about the
// admin-controlled service fee (080/081).
//
// Step 1 — JS<->Postgres parity. src/lib/pricing.ts's serviceFeeFor(rental,
// bps) is the browser's mirror of what create_booking (081) actually charges
// (`round(rental * (bps / 10000.0))`, integer arithmetic in Postgres). If the
// two ever disagree by one peso at some (rental, bps) pair, the checkout
// route's stale-total check (below) fires for a renter who did nothing
// wrong — this repo has already shipped exactly that bug once (079, a
// float-vs-numeric rounding disagreement in the tiered-rental mirror). The
// grid below is built to include every EXACT TIE reachable at each bps in
// the admin's allowed range, not a sample that happens to miss them, because
// a tie is exactly where "round half away from zero" and a careless mirror
// diverge.
//
// Step 2 — the checkout route's real behaviour on a stale total: a 409
// `total_changed` refusal that creates no PayMongo intent, paired with a
// control on the same booking that succeeds once the total matches. Driven
// against a real production build with a real signed-in throwaway renter —
// never the demo accounts, never a real charge (test-mode PayMongo keys
// only, confirmed below before anything runs).
//
// Usage:
//   npm run build && (PORT=3100 npm start &)
//   RESEND_API_KEY= node --experimental-strip-types scripts/verify/081-service-fee-client-parity.mjs [http://localhost:3100]
import { execFileSync } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'
import { serviceFeeFor, formatFeeRate } from '../../src/lib/pricing.ts'

const APP = process.argv[2] ?? 'http://localhost:3100'
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const created = { users: [], listingId: null, bookingIds: [] }

// ── Abort guard: this control creates a real test-mode PayMongo intent (a QR
// image). It must never run against a live key. ─────────────────────────────
if (!(process.env.PAYMONGO_SECRET_KEY ?? '').startsWith('sk_test_')) {
  console.log(`ABORTING: PAYMONGO_SECRET_KEY does not start with sk_test_ — refusing to run a control that mints a real PayMongo intent.`)
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: parity grid
// ═══════════════════════════════════════════════════════════════════════════

const BPS_SET = [0, 1, 100, 500, 750, 999, 1200, 1225, 1999, 2000]
const RENTAL_SET = [0, 1, 2, 3, 7, 99, 100, 999, 1000, 2499, 2500, 15250, 123457, 1000000]

/** Smallest `rental` values where `rental * bps` lands on an exact half-peso
 * boundary — i.e. `(rental * bps) % 10000 === 5000`. Brute force: the
 * repeat period of this congruence is at most 10000 (bounded by the modulus),
 * so scanning up to 2,000,000 always finds 20 solutions when any exist, and
 * terminates quickly (no solutions at all) when none do. */
function ties(bps, want = 20, upTo = 2_000_000) {
  const out = []
  if (bps === 0) return out // rental*0 is always 0, never 5000 mod 10000
  for (let r = 1; r <= upTo && out.length < want; r++) {
    if ((r * bps) % 10000 === 5000) out.push(r)
  }
  return out
}

const gridPairs = []
for (const bps of BPS_SET) for (const rental of RENTAL_SET) gridPairs.push({ rental, bps })
const tieCounts = {}
for (const bps of BPS_SET) {
  const t = ties(bps)
  tieCounts[bps] = t.length
  for (const rental of t) gridPairs.push({ rental, bps })
}

check(
  'grid: every bps admitting a tie contributes at least 20',
  BPS_SET.every((bps) => tieCounts[bps] >= 20 || tieCounts[bps] === 0),
  JSON.stringify(tieCounts)
)
check(
  'grid: at least one bps genuinely admits zero ties (the "not every bps has one" case is real)',
  Object.values(tieCounts).some((n) => n === 0),
  JSON.stringify(tieCounts)
)
check(
  'grid: at least one bps genuinely admits 20+ ties (the "most bps have one" case is real)',
  Object.values(tieCounts).some((n) => n >= 20),
  JSON.stringify(tieCounts)
)

// Postgres side, ONE query: round(rental * (bps/10000.0)) for the whole grid,
// in the exact order the VALUES list was written so JS/PG rows pair up by index.
const valuesSql = gridPairs
  .map((p, i) => `(${i}, ${p.rental}::bigint, ${p.bps}::int)`)
  .join(',\n       ')
const pgRows = JSON.parse(
  execFileSync(
    'supabase',
    ['db', 'query', '--linked', '-o', 'json', `
      select idx, rental, bps, round(rental * (bps / 10000.0))::bigint as pg_result
      from (values
       ${valuesSql}
      ) as t(idx, rental, bps)
      order by idx
    `],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
  )
).rows

check('parity: Postgres returned exactly one row per grid pair', pgRows.length === gridPairs.length, `${pgRows.length} of ${gridPairs.length}`)

let mismatches = []
for (const row of pgRows) {
  const rental = Number(row.rental)
  const bps = Number(row.bps)
  const pg = Number(row.pg_result)
  const js = serviceFeeFor(rental, bps)
  if (js !== pg) mismatches.push({ rental, bps, pg, js })
}
check(
  `parity: serviceFeeFor(rental, bps) matches Postgres round(rental * (bps/10000.0)) on every one of ${pgRows.length} grid pairs (including every exact tie)`,
  mismatches.length === 0,
  mismatches.length ? JSON.stringify(mismatches.slice(0, 10)) : ''
)

// formatFeeRate
const rateCases = { 0: '0%', 100: '1%', 500: '5%', 750: '7.5%', 1000: '10%', 1225: '12.25%', 2000: '20%' }
let rateMismatches = []
for (const [bps, expected] of Object.entries(rateCases)) {
  const got = formatFeeRate(Number(bps))
  if (got !== expected) rateMismatches.push({ bps, expected, got })
}
check('formatFeeRate matches every documented case', rateMismatches.length === 0, JSON.stringify(rateMismatches))

console.log(`\nStep 1: ${pgRows.length} (rental, bps) pairs compared (including ties per bps: ${JSON.stringify(tieCounts)}), ${mismatches.length} mismatches.\n`)

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: checkout 409 on a stale total, + the matching-total control
// ═══════════════════════════════════════════════════════════════════════════

const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`

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

async function createUser(label) {
  const email = `probe-081-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  return { id: j.id, email }
}

const before = {
  bookings: (await admin(`bookings?select=id&limit=100000`)).body.length,
  listings: (await admin(`listings?select=id&limit=100000`)).body.length,
  notifications: (await admin(`notifications?select=id&limit=100000`)).body.length,
}
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status,total_amount&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
const runStart = new Date().toISOString()

try {
  const host = await createUser('host')
  const renter = await createUser('renter')
  await admin(`profiles?id=eq.${host.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe B6 Host' }),
  })
  await admin(`profiles?id=eq.${renter.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe B6 Renter' }),
  })

  const dailyPrice = 1000
  const insertListing = await admin('listings?select=id', {
    method: 'POST',
    body: JSON.stringify({
      host_id: host.id, category: 'mirrorless', brand: 'Probe', model: 'B6',
      title: 'Probe B6 service-fee-parity listing', description: 'probe', condition: 'good',
      daily_price: dailyPrice, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
      // 066: latitude/longitude are NOT NULL. location_is_exact stays false —
      // this listing's exact pin has no bearing on service-fee parity.
      latitude: 14.5995, longitude: 120.9842, location_is_exact: false,
    }),
  })
  if (insertListing.status !== 201 || !insertListing.body?.[0]) {
    throw new Error(`listing insert failed: ${insertListing.status} ${JSON.stringify(insertListing.body)}`)
  }
  created.listingId = insertListing.body[0].id

  const session = await signInFull(renter.email, PW)
  const cookie = cookieHeaderFor(session)

  // 2 days at ₱1000/day, current platform rate 500 bps: rental 2000,
  // service_fee serviceFeeFor(2000, 500) = 100, total 2100.
  const pickupDate = '2027-04-10'
  const returnDate = '2027-04-12'
  const expectedRental = dailyPrice * 2
  const expectedServiceFee = serviceFeeFor(expectedRental, 500)
  const expectedTotal = expectedRental + expectedServiceFee

  const platformRate = (await admin('platform_settings?select=service_fee_bps')).body[0]?.service_fee_bps
  check('sanity: the live platform rate is 500 bps (this script computed expectedTotal at 500)', platformRate === 500, `${platformRate}`)

  async function checkout(body) {
    const res = await fetch(`${APP}/api/payments/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }

  // ── Refusal: a deliberately stale expectedTotal, no bookingId ────────────
  const stale = await checkout({
    listingId: created.listingId, pickupDate, returnDate, isDelivery: false,
    method: 'qrph', expectedTotal: expectedTotal - 1,
  })
  check('refusal: HTTP 409', stale.status === 409, `${stale.status} ${JSON.stringify(stale.body)}`)
  check("refusal: code === 'total_changed'", stale.body?.code === 'total_changed', JSON.stringify(stale.body?.code))
  check('refusal: amounts.service_fee_bps === 500', stale.body?.amounts?.service_fee_bps === 500, JSON.stringify(stale.body?.amounts))
  check('refusal: amounts.total_amount equals the stored total (2100)', stale.body?.amounts?.total_amount === expectedTotal, JSON.stringify(stale.body?.amounts))
  check(
    'refusal: amounts carries rental_fee, service_fee, delivery_fee, total_amount',
    ['rental_fee', 'service_fee', 'delivery_fee', 'total_amount'].every((k) => typeof stale.body?.amounts?.[k] === 'number'),
    JSON.stringify(stale.body?.amounts)
  )
  check('refusal: amounts.rental_fee/service_fee match the expected pricing', stale.body?.amounts?.rental_fee === expectedRental && stale.body?.amounts?.service_fee === expectedServiceFee, JSON.stringify(stale.body?.amounts))

  const bookingId = stale.body?.bookingId
  check('refusal: response carries a bookingId', typeof bookingId === 'string' && bookingId.length > 0, JSON.stringify(bookingId))
  if (bookingId) created.bookingIds.push(bookingId)

  // Independently, via the service role: no PayMongo intent was created before the refusal.
  const { body: [bookingRow] } = await admin(`bookings?select=id,paymongo_ref,total_amount,service_fee_bps,payment_status&id=eq.${bookingId}`)
  check('refusal: independently re-read booking has paymongo_ref = null (no intent created)', bookingRow?.paymongo_ref === null, JSON.stringify(bookingRow))
  check('refusal: independently re-read booking is still unpaid', bookingRow?.payment_status === 'unpaid', JSON.stringify(bookingRow))
  check('refusal: independently re-read booking.service_fee_bps === 500', bookingRow?.service_fee_bps === 500, JSON.stringify(bookingRow))
  check('refusal: independently re-read booking.total_amount === 2100', bookingRow?.total_amount === expectedTotal, JSON.stringify(bookingRow))

  // ── Control: the same bookingId, matching expectedTotal -> 200, real QR intent ──
  const ok = await checkout({
    listingId: created.listingId, pickupDate, returnDate, isDelivery: false,
    method: 'qrph', expectedTotal, bookingId,
  })
  check('control: HTTP 200', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`)
  check("control: status === 'qr' with a qrImage (a real test-mode PayMongo intent)", ok.body?.status === 'qr' && typeof ok.body?.qrImage === 'string', JSON.stringify(ok.body))
  check('control: same bookingId as the refusal (the booking was reused, not duplicated)', ok.body?.bookingId === bookingId, `${ok.body?.bookingId} vs ${bookingId}`)

  const { body: [bookingAfterControl] } = await admin(`bookings?select=id,paymongo_ref&id=eq.${bookingId}`)
  check('control: independently re-read booking now HAS a paymongo_ref (a real intent exists)', typeof bookingAfterControl?.paymongo_ref === 'string' && bookingAfterControl.paymongo_ref.length > 0, JSON.stringify(bookingAfterControl))

  console.log(`\nStep 2: refusal (409 total_changed, no intent) and control (200, real test-mode intent) both verified on booking ${bookingId}.\n`)
} catch (e) {
  check('script ran without throwing', false, String(e?.stack ?? e))
} finally {
  // ── Cleanup ────────────────────────────────────────────────────────────
  for (const id of created.bookingIds) {
    await admin(`bookings?id=eq.${id}`, { method: 'DELETE' })
  }
  if (created.listingId) {
    await admin(`availability_blocks?listing_id=eq.${created.listingId}`, { method: 'DELETE' })
    await admin(`listings?id=eq.${created.listingId}`, { method: 'DELETE' })
  }
  // create_booking's trigger notifies the host ('/dashboard/bookings', no id).
  for (const id of created.users) {
    await admin(`notifications?user_id=eq.${id}&created_at=gte.${runStart}`, { method: 'DELETE' })
  }
  for (const id of created.users) {
    await admin(`rate_limit_hits?key=like.*${id}*`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${id}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
  }

  // ── Re-read to prove cleanup, and baseline/forbidden-row checks ──────────
  const cleanupDetail = []
  for (const id of created.bookingIds) {
    const n = (await admin(`bookings?select=id&id=eq.${id}`)).body.length
    if (n) cleanupDetail.push(`booking:${id}`)
  }
  if (created.listingId) {
    const n = (await admin(`listings?select=id&id=eq.${created.listingId}`)).body.length
    if (n) cleanupDetail.push(`listing:${created.listingId}`)
    const ab = (await admin(`availability_blocks?select=id&listing_id=eq.${created.listingId}`)).body.length
    if (ab) cleanupDetail.push(`availability_blocks:${ab}`)
  }
  for (const id of created.users) {
    const p = (await admin(`profiles?select=id&id=eq.${id}`)).body.length
    if (p) cleanupDetail.push(`profile:${id}`)
    const rl = (await admin(`rate_limit_hits?select=key&key=like.*${id}*`)).body.length
    if (rl) cleanupDetail.push(`rate_limit_hits:${id}`)
    const notifs = (await admin(`notifications?select=id&user_id=eq.${id}`)).body.length
    if (notifs) cleanupDetail.push(`notifications:${id}`)
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
    if (r.status !== 404) cleanupDetail.push(`auth:${id}:${r.status}`)
  }
  check('cleanup: every probe booking/listing/profile/notification/rate_limit_hits/auth row is gone', cleanupDetail.length === 0, cleanupDetail.join(', '))

  const after = {
    bookings: (await admin(`bookings?select=id&limit=100000`)).body.length,
    listings: (await admin(`listings?select=id&limit=100000`)).body.length,
    notifications: (await admin(`notifications?select=id&limit=100000`)).body.length,
  }
  for (const t of Object.keys(before)) {
    check(`baseline: ${t} count unchanged`, before[t] === after[t], `${before[t]} -> ${after[t]}`)
  }

  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status,total_amount&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('forbidden host untouched', JSON.stringify(fHostAfter) === JSON.stringify(fHostBefore))
  check('forbidden booking untouched', JSON.stringify(fBookingAfter) === JSON.stringify(fBookingBefore))

  done()
}
