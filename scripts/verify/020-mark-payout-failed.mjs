// Verifies mark_payout_failed (020) and POST /api/admin/payout-requests/[id]/failed.
//
// Why this script exists: this is the one admin payout branch that had never
// been run against a live row. AGENTS.md recorded it honestly as an accepted
// gap — the route was read against the RPC signature twice and observed to
// mirror the already-verified Mark Paid route, but never executed. The reason
// it stayed unverified is that it needs an eligible completed+paid booking,
// and the demo host's only one is permanently claimed by a `paid` request
// (there is no RPC to reverse a paid payout, by design).
//
// So this builds its own: throwaway host + renter + listing + booking, driven
// to `completed` through the host's OWN session so the enforce_booking_transition
// trigger really approves each step. Real sessions for every authorisation
// claim; service role only for setup, independent re-reads and cleanup.
//
// Usage: node --experimental-strip-types scripts/verify/020-mark-payout-failed.mjs [appUrl]
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn } from './env.mjs'

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
  if (!json.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(json)}`)
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
const failedRoute = (id, cookie, body) =>
  fetch(`${APP}/api/admin/payout-requests/${id}/failed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })

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
  accounts: (await admin('payout_accounts?select=id')).body.length,
  requests: (await admin('payout_requests?select=id')).body.length,
  items: (await admin('payout_items?select=id')).body.length,
})

const before = await baseline()
const stamp = Date.now()
const hostEmail = `probe-payoutfail-host-${stamp}@example.com`
const renterEmail = `probe-payoutfail-renter-${stamp}@example.com`
const hostId = await createUser(hostEmail)
const renterId = await createUser(renterEmail)
let listingId = null
let bookingId = null

try {
  const adminCookie = cookieHeaderFor(await signInFull('demo@demo.rentivo.ph', 'DemoRentivo1'))
  const renterDemoCookie = cookieHeaderFor(await signInFull('renter@demo.rentivo.ph', 'DemoRentivo1'))

  // ── setup ──────────────────────────────────────────────────────────────
  // is_verified so migration 037's trigger doesn't force the listing to draft.
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Payout Host' }),
  })
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe Payout Renter' }),
  })
  const { body: [listing] } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'P1',
      title: 'Probe payout-failed listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila',
      is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
    }),
  })
  listingId = listing.id

  const hostTok = await signIn(hostEmail, 'ProbeRentivo1')
  const renterTok = await signIn(renterEmail, 'ProbeRentivo1')

  // 'card' deliberately — host_qr and test_skip are excluded from payouts.
  const created = await rpc(renterTok, 'create_booking', {
    p_listing_id: listingId, p_pickup_date: '2029-05-10', p_return_date: '2029-05-12',
    p_is_delivery: false, p_delivery_address: null, p_payment_method: 'card', p_promo_code: null,
  })
  if (created.status !== 200) throw new Error('create_booking: ' + JSON.stringify(created.body))
  bookingId = created.body.id
  const payable = created.body.rental_fee + created.body.delivery_fee

  const paidRes = await rpc(SECRET, 'mark_booking_paid', { p_booking_id: bookingId, p_paymongo_ref: 'pi_probe_payoutfail' })
  check('setup: mark_booking_paid -> paid', paidRes.status === 200, `${paidRes.status}`)

  // Walk to completed through the HOST's own session, so the transition
  // trigger actually approves each hop rather than being bypassed by the
  // service role (auth.uid() null short-circuits it).
  for (const next of ['confirmed', 'active', 'completed']) {
    const r = await asUser(hostTok, `bookings?id=eq.${bookingId}`, {
      method: 'PATCH', body: JSON.stringify({ status: next }),
    })
    check(`setup: host transitions booking -> ${next}`, r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 90)}`)
  }

  // ── payout account + request ───────────────────────────────────────────
  const setAcct = await rpc(hostTok, 'set_payout_account', {
    p_method: 'GCash', p_account_number: '09171234567', p_account_name: 'Probe Payout Host',
  })
  check('host sets a payout account', setAcct.status === 200, `${setAcct.status}`)

  const early = await rpc(hostTok, 'request_payout')
  check('CONTROL: request_payout refused while the account is unverified',
    early.status >= 400, `${early.status} ${JSON.stringify(early.body?.message ?? early.body).slice(0, 80)}`)

  const acctId = (await admin(`payout_accounts?select=id&user_id=eq.${hostId}`)).body[0].id
  const review = await rpc(SECRET, 'review_payout_account', { p_account_id: acctId, p_approve: true, p_notes: null })
  check('admin verifies the payout account', review.status === 200, `${review.status}`)

  const req = await rpc(hostTok, 'request_payout')
  check('request_payout creates a pending request', req.status === 200 && req.body?.status === 'pending', `${req.status}`)
  const requestId = req.body?.id
  check('request amount = rental_fee + delivery_fee', req.body?.amount === payable, `${req.body?.amount} vs ${payable}`)
  const { body: items } = await admin(`payout_items?select=booking_id&payout_request_id=eq.${requestId}`)
  check('request itemizes exactly the probe booking', items.length === 1 && items[0].booking_id === bookingId)

  // ── the branch under test: auth matrix, then the real call ─────────────
  const out = await failedRoute(requestId, null, { reason: 'x' })
  check('signed-out -> 404', out.status === 404, `${out.status}`)

  const nonAdmin = await failedRoute(requestId, renterDemoCookie, { reason: 'x' })
  check('non-admin (demo renter) -> 404', nonAdmin.status === 404, `${nonAdmin.status}`)

  const noReason = await failedRoute(requestId, adminCookie, {})
  check('admin without a reason -> 400', noReason.status === 400, `${noReason.status}`)

  const blank = await failedRoute(requestId, adminCookie, { reason: '   ' })
  check('admin with a whitespace-only reason -> 400', blank.status === 400, `${blank.status}`)

  const REASON = 'Probe run: recipient account number rejected by the bank.'
  const marked = await failedRoute(requestId, adminCookie, { reason: REASON })
  const markedBody = await marked.json().catch(() => null)
  check('admin marks the request failed -> 200', marked.status === 200, `${marked.status}`)
  check('response carries status failed', markedBody?.request?.status === 'failed', JSON.stringify(markedBody).slice(0, 100))

  // Independent re-read — never trust the route's own echo.
  const { body: [stored] } = await admin(`payout_requests?select=status,notes,processed_at,amount,host_id&id=eq.${requestId}`)
  check('stored row is failed', stored?.status === 'failed', `${stored?.status}`)
  check('stored notes = the admin-supplied reason', stored?.notes === REASON, JSON.stringify(stored?.notes))
  check('processed_at was set', Boolean(stored?.processed_at))
  check('amount unchanged by the failure', stored?.amount === payable, `${stored?.amount}`)

  // Idempotency — the RPC returns the row untouched on a retry.
  const retry = await failedRoute(requestId, adminCookie, { reason: 'a different second reason' })
  const retryBody = await retry.json().catch(() => null)
  check('retry is idempotent -> 200, still failed', retry.status === 200 && retryBody?.request?.status === 'failed', `${retry.status}`)
  const { body: [afterRetry] } = await admin(`payout_requests?select=notes&id=eq.${requestId}`)
  check('retry did NOT overwrite the original reason', afterRetry?.notes === REASON, JSON.stringify(afterRetry?.notes))

  // The documented consequence: a failed request releases its bookings.
  const reRequest = await rpc(hostTok, 'request_payout')
  check('booking is eligible again after the failure', reRequest.status === 200 && reRequest.body?.status === 'pending', `${reRequest.status}`)
  check('re-request covers the same amount', reRequest.body?.amount === payable, `${reRequest.body?.amount}`)
  check('re-request is a NEW request row', reRequest.body?.id !== requestId)

  // Grant boundary: the RPC is service_role only.
  const direct = await rpc(hostTok, 'mark_payout_failed', { p_request_id: requestId, p_notes: 'nope' })
  check('host cannot call mark_payout_failed directly', direct.status === 404 || direct.status === 403,
    `${direct.status} ${JSON.stringify(direct.body?.message ?? '').slice(0, 60)}`)
  // 401 here, not 403: with no JWT at all PostgREST rejects before it ever
  // reaches the function's grant list. Both are denials; accept either.
  const anonDirect = await rpc(null, 'mark_payout_failed', { p_request_id: requestId, p_notes: 'nope' })
  check('anon cannot call mark_payout_failed directly', [401, 403, 404].includes(anonDirect.status), `${anonDirect.status}`)

  const unknown = await failedRoute('00000000-0000-4000-8000-000000000000', adminCookie, { reason: 'x' })
  check('unknown request id -> 400 from the RPC', unknown.status === 400, `${unknown.status}`)
} finally {
  // ── cleanup, in FK order ───────────────────────────────────────────────
  const { body: reqs } = await admin(`payout_requests?select=id&host_id=eq.${hostId}`)
  for (const r of reqs ?? []) await admin(`payout_items?payout_request_id=eq.${r.id}`, { method: 'DELETE' })
  await admin(`payout_requests?host_id=eq.${hostId}`, { method: 'DELETE' })
  await admin(`payout_accounts?user_id=eq.${hostId}`, { method: 'DELETE' })
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

  const after = await baseline()
  const same = Object.keys(before).every((k) => before[k] === after[k])
  check('baseline restored', same, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)

  const { body: forbidden } = await admin(`profiles?select=id,suspended_at&id=eq.${FORBIDDEN_HOST}`)
  check('forbidden real host untouched', forbidden.length === 1 && forbidden[0].suspended_at === null)

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
  process.exit(fails === 0 ? 0 : 1)
}
