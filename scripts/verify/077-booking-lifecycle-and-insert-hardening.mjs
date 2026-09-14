// Verifies migration 077 (security audit 2, database side).
//
// Re-runs each audit reproduction and proves it now fails, each paired with a
// CONTROL proving the legitimate action still works. Every authorisation claim
// uses a REAL signed-in session on the anon key; the service role is used only
// for setup (backdating dates, marking paid, suspending), independent re-reads
// and cleanup. Grant denials ("permission denied") are told apart from RLS
// denials ("row-level security") and from silent zero-row updates.
//
// Throwaway @example.com accounts and listings only. The forbidden host and
// booking are only read, before and after.
//
// Usage: node scripts/verify/077-booking-lifecycle-and-insert-hardening.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const runStartedAt = new Date().toISOString()
const created = { users: [], listings: [], viewKeys: [] }

// ── helpers ──────────────────────────────────────────────────────────────
async function createUser(label) {
  const email = `probe-077-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  const s = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json())
  if (!s.access_token) throw new Error('sign-in failed ' + email)
  return { id: j.id, token: s.access_token }
}
async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: token === SECRET ? SECRET : ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const msg = (r) => JSON.stringify(r.body ?? '')
const permDenied = (r) => [401, 403].includes(r.status) && msg(r).includes('permission denied')
const rlsDenied = (r) => r.status === 403 && msg(r).includes('row-level security')
const raised = (r, text) => r.status === 400 && msg(r).includes(text)
const ok = (r) => r.status >= 200 && r.status < 300

const utcToday = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
const day = (n) => new Date(utcToday.getTime() + n * 86400000).toISOString().slice(0, 10)

async function newListing(hostId, label, extra = {}) {
  const { status, body } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, title: `Probe 077 ${label} ${stamp}`, brand: 'Sony', model: 'A7 IV',
      category: 'mirrorless', condition: 'excellent', description: 'Probe listing for 077.',
      daily_price: 1000, security_deposit: 0, delivery_fee: null, city: 'Manila', province: 'Metro Manila',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false, is_instant_book: false,
      latitude: 14.5995, longitude: 120.9842, location_is_exact: true, ...extra,
    }),
  })
  if (status !== 201) throw new Error('newListing: ' + JSON.stringify(body))
  created.listings.push(body[0].id)
  created.viewKeys.push(`view:${body[0].id}`)
  return body[0].id
}
const book = (u, listingId, from, to) =>
  rpc(u.token, 'create_booking', { p_listing_id: listingId, p_pickup_date: from, p_return_date: to, p_payment_method: 'qrph' })
const markPaid = (bookingId) => rpc(SECRET, 'mark_booking_paid', { p_booking_id: bookingId, p_paymongo_ref: 'pi_probe_077' })
const setStatus = (u, bookingId, status) =>
  asUser(u.token, `bookings?id=eq.${bookingId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
const adminPatchBooking = (id, patch) => admin(`bookings?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
const readBooking = async (id) => (await admin(`bookings?select=*&id=eq.${id}`)).body[0]
const readListing = async (id) => (await admin(`listings?select=rating,review_count,view_count,is_active&id=eq.${id}`)).body[0]
const suspend = (id, on) =>
  admin(`profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ suspended_at: on ? new Date().toISOString() : null }) })
// Manila "today" as the database sees it.
const manilaToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)

async function cleanup() {
  const users = created.users
  for (const u of users) {
    const { body: reqs } = await admin(`payout_requests?select=id&host_id=eq.${u}`)
    for (const r of reqs ?? []) {
      await admin(`payout_items?payout_request_id=eq.${r.id}`, { method: 'DELETE' })
      await admin(`payout_requests?id=eq.${r.id}`, { method: 'DELETE' })
    }
    await admin(`payout_accounts?user_id=eq.${u}`, { method: 'DELETE' })
  }
  for (const u of users) {
    await admin(`reviews?or=(reviewer_id.eq.${u},reviewee_id.eq.${u})`, { method: 'DELETE' })
  }
  for (const u of users) {
    await admin(`messages?sender_id=eq.${u}`, { method: 'DELETE' })
    await admin(`bookings?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`verification_requests?user_id=eq.${u}`, { method: 'DELETE' })
  }
  for (const id of created.listings) {
    await admin(`availability_blocks?listing_id=eq.${id}`, { method: 'DELETE' })
    await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const k of created.viewKeys) await admin(`rate_limit_hits?key=eq.${encodeURIComponent(k)}`, { method: 'DELETE' })
  for (const u of users) {
    await admin(`rate_limit_hits?key=like.*:${u}`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, {
      method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  }
}

const countOf = async (t) => (await admin(`${t}?select=id&limit=100000`)).body.length
const TABLES = ['bookings', 'conversations', 'messages', 'reviews', 'listings', 'profiles', 'availability_blocks', 'verification_requests', 'payout_requests']
const before = {}
for (const t of TABLES) before[t] = await countOf(t)
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

try {
  // ── setup ──────────────────────────────────────────────────────────────
  const H = await createUser('host')
  const H2 = await createUser('host2')
  for (const h of [H, H2]) {
    await admin(`profiles?id=eq.${h.id}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 077 Host' }) })
  }
  const R1 = await createUser('r1')
  const R2 = await createUser('r2')
  const R3 = await createUser('r3')
  const R4 = await createUser('r4')
  const R5 = await createUser('r5')
  const L1 = await newListing(H.id, 'L1')
  const L2 = await newListing(H2.id, 'L2')                       // the "unrelated" listing
  const L3 = await newListing(H2.id, 'L3', { is_instant_book: true })

  // ════ MEDIUM-3: confirm requires payment; active/completed respect dates ══
  {
    const unpaid = await book(R1, L1, day(20), day(22))
    check('setup: unpaid pending booking created', ok(unpaid), msg(unpaid))
    const r = await setStatus(H, unpaid.body.id, 'confirmed')
    check('REFUSED: host confirms an UNPAID booking', raised(r, 'has not been paid yet'), msg(r))
    check('  … and it is still pending (re-read)', (await readBooking(unpaid.body.id)).status === 'pending')
  }
  const B2 = (await book(R1, L1, day(30), day(33))).body
  await markPaid(B2.id)
  {
    const r = await setStatus(H, B2.id, 'confirmed')
    check('CONTROL: host confirms a PAID booking', ok(r) && r.body[0]?.status === 'confirmed', msg(r))
    const act = await setStatus(H, B2.id, 'active')
    check('REFUSED: →active before the pickup date', raised(act, 'cannot start before its pickup date'), msg(act))
    // Backdate pickup to Manila-yesterday; return stays in the future.
    await adminPatchBooking(B2.id, { pickup_date: addDays(manilaToday, -1), return_date: addDays(manilaToday, 2) })
    const act2 = await setStatus(H, B2.id, 'active')
    check('CONTROL: →active once the pickup date has come', ok(act2) && act2.body[0]?.status === 'active', msg(act2))
    const comp = await setStatus(H, B2.id, 'completed')
    check('REFUSED: →completed before the return date', raised(comp, 'cannot be completed before its return date'), msg(comp))
  }

  // ════ MEDIUM-3: request_payout excludes a not-yet-returned booking ═══════
  const acct = await admin('payout_accounts', {
    method: 'POST',
    body: JSON.stringify({ user_id: H.id, method: 'GCash', account_number: '09000000077', account_name: 'Probe 077', status: 'verified' }),
  })
  check('setup: verified payout account for the probe host', acct.status === 201, msg(acct))
  const B14 = (await book(R2, L1, day(200), day(202))).body
  await markPaid(B14.id)
  // Forced by the service role into the exact shape the audit exploited:
  // completed + paid, with the return date still in the future.
  await adminPatchBooking(B14.id, { status: 'completed' })
  {
    const r = await rpc(H.token, 'request_payout', {})
    check('REFUSED: request_payout with only a completed-but-not-returned booking', raised(r, 'No available balance'), msg(r))
  }
  // Now let B2's return day arrive and complete it for real.
  await adminPatchBooking(B2.id, { pickup_date: addDays(manilaToday, -3), return_date: manilaToday })
  {
    const comp = await setStatus(H, B2.id, 'completed')
    check('CONTROL: →completed on the return date', ok(comp) && comp.body[0]?.status === 'completed', msg(comp))
    const r = await rpc(H.token, 'request_payout', {})
    const { body: items } = ok(r) ? await admin(`payout_items?select=booking_id&payout_request_id=eq.${r.body.id}`) : { body: [] }
    const ids = items.map((i) => i.booking_id)
    check('CONTROL: request_payout pays the returned booking', ok(r) && ids.includes(B2.id) && Number(r.body.amount) === B2.rental_fee + B2.delivery_fee, msg(r))
    check('  … and does not include the not-yet-returned booking', !ids.includes(B14.id), JSON.stringify(ids))
  }

  // ════ HIGH-1: fake reviews ════════════════════════════════════════════════
  {
    // Unpaid booking forced to completed (the audit's host-completes-unpaid path).
    const B3 = (await book(R3, L1, day(210), day(212))).body
    await adminPatchBooking(B3.id, { status: 'completed' })
    const r = await asUser(R3.token, 'reviews', {
      method: 'POST',
      body: JSON.stringify({ booking_id: B3.id, reviewer_id: R3.id, reviewee_id: H.id, listing_id: L1, rating: 1, comment: 'probe' }),
    })
    check('REFUSED: review on a completed but UNPAID booking', rlsDenied(r), msg(r))
  }
  {
    const L2before = await readListing(L2)
    // LOW-2: forged created_at on a review insert
    const forged = await asUser(R1.token, 'reviews', {
      method: 'POST',
      body: JSON.stringify({ booking_id: B2.id, reviewer_id: R1.id, reviewee_id: H.id, listing_id: L1, rating: 5, comment: 'probe', created_at: '2026-01-01T00:00:00Z' }),
    })
    check('REFUSED: review insert naming created_at', permDenied(forged), msg(forged))
    // The audit's exact reproduction: listing_id of an unrelated listing.
    const r = await asUser(R1.token, 'reviews', {
      method: 'POST',
      body: JSON.stringify({ booking_id: B2.id, reviewer_id: R1.id, reviewee_id: H.id, listing_id: L2, rating: 4, comment: 'probe renter review' }),
    })
    check('CONTROL: renter review on a paid, completed booking succeeds', r.status === 201, msg(r))
    check('  … its client-sent listing_id (unrelated L2) was ignored — stored on the booking\'s listing L1',
      r.body?.[0]?.listing_id === L1, msg(r))
    const L2after = await readListing(L2)
    check('  … the unrelated listing\'s rating/review_count did not move',
      L2after.rating === L2before.rating && L2after.review_count === L2before.review_count, JSON.stringify(L2after))
    const L1now = await readListing(L1)
    check('  … the booking\'s own listing now rates 4 from 1 review', Number(L1now.rating) === 4 && L1now.review_count === 1, JSON.stringify(L1now))

    // Suspended host cannot review; unsuspended can. Host review lands with listing_id null.
    await suspend(H.id, true)
    const hs = await asUser(H.token, 'reviews', {
      method: 'POST',
      body: JSON.stringify({ booking_id: B2.id, reviewer_id: H.id, reviewee_id: R1.id, listing_id: L2, rating: 1, comment: 'probe host review' }),
    })
    check('REFUSED: suspended host (still-valid token) inserts a review', rlsDenied(hs), msg(hs))
    await suspend(H.id, false)
    const hr = await asUser(H.token, 'reviews', {
      method: 'POST',
      body: JSON.stringify({ booking_id: B2.id, reviewer_id: H.id, reviewee_id: R1.id, listing_id: L2, rating: 1, comment: 'probe host review' }),
    })
    check('CONTROL: unsuspended host reviews the renter', hr.status === 201, msg(hr))
    check('  … host-about-renter review carries listing_id null', hr.body?.[0]?.listing_id === null, msg(hr))
    check('  … L2 still untouched', JSON.stringify(await readListing(L2)) === JSON.stringify(L2after))

    // Recalculation counts only reviews whose reviewee is the listing's host.
    // Force the host review onto L1 (service role) — the update fires the recalc.
    await admin(`reviews?id=eq.${hr.body[0].id}`, { method: 'PATCH', body: JSON.stringify({ listing_id: L1 }) })
    const L1after = await readListing(L1)
    check('rating recalculation ignores a host-about-renter review carrying the listing id',
      Number(L1after.rating) === 4 && L1after.review_count === 1, JSON.stringify(L1after))
  }

  // ════ HIGH-2 (a): pre-block → confirm → delete no longer reopens dates ════
  {
    const B5 = (await book(R2, L1, day(40), day(43))).body
    const blk = await asUser(H.token, 'availability_blocks', {
      method: 'POST', body: JSON.stringify({ listing_id: L1, blocked_on: day(41), reason: 'manual' }),
    })
    check('setup: host pre-blocks a day inside a pending booking', blk.status === 201, msg(blk))
    await markPaid(B5.id)
    const conf = await setStatus(H, B5.id, 'confirmed')
    check('setup: host confirms the paid booking', ok(conf) && conf.body[0]?.status === 'confirmed', msg(conf))
    const { body: [row] } = await admin(`availability_blocks?select=reason&listing_id=eq.${L1}&blocked_on=eq.${day(41)}`)
    check('the pre-existing manual row became reason=booked on confirmation', row?.reason === 'booked', JSON.stringify(row))
    const del = await asUser(H.token, `availability_blocks?listing_id=eq.${L1}&blocked_on=eq.${day(41)}`, { method: 'DELETE' })
    const { body: still } = await admin(`availability_blocks?select=id&listing_id=eq.${L1}&blocked_on=eq.${day(41)}`)
    check('REFUSED: host deletes that row (0 rows, row still present)', ok(del) && del.body.length === 0 && still.length === 1, msg(del))
    const s = await book(R3, L1, day(41), day(42))
    check('REFUSED: a stranger books the reopened day', raised(s, 'no longer available'), msg(s))

    // Control: an ordinary manual block outside any booking is still deletable.
    await asUser(H.token, 'availability_blocks', { method: 'POST', body: JSON.stringify({ listing_id: L1, blocked_on: day(50), reason: 'manual' }) })
    const del2 = await asUser(H.token, `availability_blocks?listing_id=eq.${L1}&blocked_on=eq.${day(50)}`, { method: 'DELETE' })
    check('CONTROL: host deletes a manual block outside any booking', ok(del2) && del2.body.length === 1, msg(del2))

    // New booking over held dates, proved against the BOOKINGS guard, not the
    // derived block rows: delete the block rows first (service role), then book.
    await admin(`availability_blocks?listing_id=eq.${L1}&blocked_on=gte.${day(40)}&blocked_on=lt.${day(43)}`, { method: 'DELETE' })
    const over = await book(R4, L1, day(42), day(44))
    check('REFUSED: new booking over dates held by a confirmed booking (with its block rows gone)', raised(over, 'no longer available'), msg(over))
    const edge = await book(R4, L1, day(43), day(45))
    check('CONTROL: a booking starting on the held booking\'s return day is allowed (half-open)', ok(edge), msg(edge))
    const free = await book(R4, L1, day(60), day(61))
    check('CONTROL: a booking over free dates succeeds', ok(free), msg(free))
  }

  // ════ HIGH-2 (b): overlapping confirmations ═════════════════════════════
  {
    const B6 = (await book(R2, L1, day(70), day(73))).body
    const B7 = (await book(R3, L1, day(71), day(72))).body
    const B8 = (await book(R5, L1, day(73), day(75))).body   // starts on B6's return day
    check('setup: three pending bookings (two overlapping, one adjacent)', !!(B6?.id && B7?.id && B8?.id))
    for (const b of [B6, B7, B8]) await markPaid(b.id)
    const c6 = await setStatus(H, B6.id, 'confirmed')
    check('CONTROL: first confirmation succeeds', ok(c6) && c6.body[0]?.status === 'confirmed', msg(c6))
    const c7 = await setStatus(H, B7.id, 'confirmed')
    check('REFUSED: second, overlapping confirmation', raised(c7, 'already booked by another confirmed rental'), msg(c7))
    check('  … it is still pending', (await readBooking(B7.id)).status === 'pending')
    const c8 = await setStatus(H, B8.id, 'confirmed')
    check('CONTROL: adjacent booking (ends-on/starts-on the same day) confirms', ok(c8) && c8.body[0]?.status === 'confirmed', msg(c8))
  }

  // ════ race: concurrent overlapping confirmations ═════════════════════════
  {
    let bothSucceeded = 0
    let exactlyOne = 0
    for (let i = 0; i < 3; i++) {
      const base = 100 + i * 10
      const a = (await book(R2, L1, day(base), day(base + 3))).body
      const b = (await book(R3, L1, day(base + 1), day(base + 4))).body
      await markPaid(a.id); await markPaid(b.id)
      const [ra, rb] = await Promise.all([setStatus(H, a.id, 'confirmed'), setStatus(H, b.id, 'confirmed')])
      const okA = ok(ra) && ra.body[0]?.status === 'confirmed'
      const okB = ok(rb) && rb.body[0]?.status === 'confirmed'
      const sa = (await readBooking(a.id)).status
      const sb = (await readBooking(b.id)).status
      if (okA && okB) bothSucceeded++
      if ((okA !== okB) && [sa, sb].filter((s) => s === 'confirmed').length === 1) exactlyOne++
    }
    check('RACE: 3 concurrent pairs of overlapping confirmations — exactly one confirmed each time', exactlyOne === 3 && bothSucceeded === 0, `exactlyOne=${exactlyOne} both=${bothSucceeded}`)
  }

  // ════ service role: Instant Book pay over held dates keeps working ═══════
  {
    const a = (await book(R1, L3, day(10), day(12))).body
    const b = (await book(R5, L3, day(11), day(13))).body
    const pa = await markPaid(a.id)
    check('CONTROL: mark_booking_paid flips Instant Book to confirmed', ok(pa) && pa.body.status === 'confirmed', msg(pa))
    const pb = await markPaid(b.id)
    check('mark_booking_paid over now-held dates records the payment without raising …', ok(pb) && pb.body.payment_status === 'paid', msg(pb))
    check('  … and leaves that booking pending (no double-booking)', pb.body.status === 'pending', msg(pb))
  }

  // ════ LOW-3: notes ══════════════════════════════════════════════════════
  {
    const nb = (await book(R5, L1, day(260), day(261))).body
    const r1 = await asUser(R5.token, `bookings?id=eq.${nb.id}`, { method: 'PATCH', body: JSON.stringify({ host_notes: 'overwritten by renter' }) })
    check('REFUSED: renter overwrites host_notes', raised(r1, 'Only the host'), msg(r1))
    const r2 = await asUser(R5.token, `bookings?id=eq.${nb.id}`, { method: 'PATCH', body: JSON.stringify({ renter_notes: 'renter note' }) })
    check('CONTROL: renter edits renter_notes', ok(r2) && r2.body[0]?.renter_notes === 'renter note', msg(r2))
    const h1 = await asUser(H.token, `bookings?id=eq.${nb.id}`, { method: 'PATCH', body: JSON.stringify({ renter_notes: 'overwritten by host' }) })
    check('REFUSED: host overwrites renter_notes', raised(h1, 'Only the renter'), msg(h1))
    const h2 = await asUser(H.token, `bookings?id=eq.${nb.id}`, { method: 'PATCH', body: JSON.stringify({ host_notes: 'host note' }) })
    check('CONTROL: host edits host_notes', ok(h2) && h2.body[0]?.host_notes === 'host note', msg(h2))
  }

  // ════ LOW-1: suspension, plus LOW-2 messages and I-4 ════════════════════
  {
    const inq = await rpc(R4.token, 'create_inquiry', { p_listing_id: L2, p_content: 'probe inquiry' })
    check('setup: renter opens an inquiry', ok(inq), msg(inq))
    const convoId = inq.body
    const sendAs = (u, extra = {}) => asUser(u.token, 'messages', {
      method: 'POST', body: JSON.stringify({ conversation_id: convoId, sender_id: u.id, content: 'probe message', image_url: null, ...extra }),
    })

    // LOW-2
    const fc = await sendAs(R4, { created_at: '2026-01-01T00:00:00Z' })
    check('REFUSED: message insert with forged created_at', permDenied(fc), msg(fc))
    const fr = await sendAs(R4, { is_read: true })
    check('REFUSED: message insert with forged is_read', permDenied(fr), msg(fr))
    const normal = await sendAs(R4)
    check('CONTROL: a normal message (the composer\'s exact column set) sends', normal.status === 201 && normal.body[0]?.is_read === false, msg(normal))

    // I-4
    const dashes = await sendAs(R4, { image_url: `${R4.id}/${'-'.repeat(36)}.png` })
    check('REFUSED: image path whose filename is 36 dashes', dashes.status === 400 && msg(dashes).includes('messages_image_path_shape'), msg(dashes))
    const goodPath = await sendAs(R4, { image_url: `${R4.id}/${crypto.randomUUID()}.png` })
    check('CONTROL: image path with a real UUID filename', goodPath.status === 201, msg(goodPath))
    const otherFolder = await sendAs(R4, { image_url: `${R5.id}/${crypto.randomUUID()}.png` })
    check('REFUSED: image path in another user\'s folder (binding kept)', otherFolder.status === 400, msg(otherFolder))

    // LOW-1 — renter side
    const pend = (await book(R4, L1, day(270), day(271))).body
    await suspend(R4.id, true)
    const sm = await sendAs(R4)
    check('REFUSED: suspended renter sends a message', rlsDenied(sm), msg(sm))
    const sb = await book(R4, L1, day(280), day(281))
    check('REFUSED: suspended renter runs create_booking', raised(sb, 'Your account is suspended'), msg(sb))
    const sc = await setStatus(R4, pend.id, 'cancelled')
    check('REFUSED: suspended renter\'s booking update matches 0 rows', ok(sc) && sc.body.length === 0 && (await readBooking(pend.id)).status === 'pending', msg(sc))
    await suspend(R4.id, false)
    const um = await sendAs(R4)
    check('CONTROL: unsuspended renter sends a message', um.status === 201, msg(um))
    const ub = await book(R4, L1, day(280), day(281))
    check('CONTROL: unsuspended renter books', ok(ub), msg(ub))
    const uc = await setStatus(R4, pend.id, 'cancelled')
    check('CONTROL: unsuspended renter cancels their pending booking', ok(uc) && uc.body[0]?.status === 'cancelled', msg(uc))

    // LOW-1 — host side
    const hp = (await book(R5, L1, day(290), day(291))).body
    await markPaid(hp.id)
    await suspend(H.id, true)
    const hb = await asUser(H.token, 'availability_blocks', { method: 'POST', body: JSON.stringify({ listing_id: L1, blocked_on: day(300), reason: 'manual' }) })
    check('REFUSED: suspended host inserts an availability block', rlsDenied(hb), msg(hb))
    const hc = await setStatus(H, hp.id, 'confirmed')
    check('REFUSED: suspended host\'s status update matches 0 rows', ok(hc) && hc.body.length === 0 && (await readBooking(hp.id)).status === 'pending', msg(hc))
    await suspend(H.id, false)
    const hb2 = await asUser(H.token, 'availability_blocks', { method: 'POST', body: JSON.stringify({ listing_id: L1, blocked_on: day(300), reason: 'manual' }) })
    check('CONTROL: unsuspended host inserts an availability block', hb2.status === 201, msg(hb2))
    const hc2 = await setStatus(H, hp.id, 'confirmed')
    check('CONTROL: unsuspended host confirms', ok(hc2) && hc2.body[0]?.status === 'confirmed', msg(hc2))
  }

  // ════ LOW-4: verification requests ══════════════════════════════════════
  {
    const payload = { user_id: R5.id, id_doc_path: `${R5.id}/id-probe.jpg`, selfie_path: `${R5.id}/selfie-probe.jpg`, auto_check_failed: false, auto_check_detail: null }
    const forged = await asUser(R5.token, 'verification_requests', {
      method: 'POST', body: JSON.stringify({ ...payload, status: 'approved', reviewer_notes: 'looks good', reviewed_at: new Date().toISOString() }),
    })
    check('REFUSED: self-approved verification request insert', permDenied(forged), msg(forged))
    const normal = await asUser(R5.token, 'verification_requests', { method: 'POST', body: JSON.stringify(payload) })
    check('CONTROL: the upload flow\'s exact insert succeeds as pending', normal.status === 201 && normal.body[0]?.status === 'pending' && normal.body[0]?.reviewed_at === null, msg(normal))
  }

  // ════ LOW-5: view increments capped ═════════════════════════════════════
  {
    const L4 = await newListing(H.id, 'views')
    const first = await rpc(null, 'increment_listing_view', { p_listing_id: L4 })
    check('CONTROL: anon view increment counts', ok(first) && (await readListing(L4)).view_count === 1, msg(first))
    let lastStatus = 0
    for (let i = 0; i < 129; i++) lastStatus = (await rpc(null, 'increment_listing_view', { p_listing_id: L4 })).status
    const v = (await readListing(L4)).view_count
    check('REFUSED (silently): 130 anon calls in an hour count only 120 views', v === 120 && lastStatus >= 200 && lastStatus < 300, `view_count=${v} last=${lastStatus}`)
  }

  // ════ LOW-6: deleting a listing keeps its conversations ═════════════════
  {
    const L5 = await newListing(H.id, 'with-thread')
    const inq = await rpc(R5.token, 'create_inquiry', { p_listing_id: L5, p_content: 'is this available?' })
    check('setup: renter inquiry on a listing with no bookings', ok(inq), msg(inq))
    // return=minimal, as supabase-js sends for a bare .delete(): listings has
    // column-level SELECT since 064, so return=representation would 42501.
    const del = await asUser(H.token, `listings?id=eq.${L5}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const { body: convo } = await admin(`conversations?select=id&id=eq.${inq.body}`)
    const { body: msgs } = await admin(`messages?select=id&conversation_id=eq.${inq.body}`)
    check('REFUSED: host deletes a listing that has a renter thread (23503)', del.status === 409 && msg(del).includes('23503'), msg(del))
    check('  … the conversation and its message survive', convo.length === 1 && msgs.length === 1)
    const L6 = await newListing(H.id, 'no-thread')
    const del2 = await asUser(H.token, `listings?id=eq.${L6}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    const { body: gone } = await admin(`listings?select=id&id=eq.${L6}`)
    check('CONTROL: host deletes a listing with no threads or bookings', ok(del2) && gone.length === 0, msg(del2))
    // The app's fallback (useMyListings.deleteOrDeactivateListing): deactivate.
    const pause = await asUser(H.token, `listings?id=eq.${L5}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_active: false }) })
    check('CONTROL: the refused listing can be deactivated instead', ok(pause) && (await readListing(L5)).is_active === false, msg(pause))
  }
} catch (e) {
  check('script ran without an unexpected exception', false, e.stack)
} finally {
  await cleanup()
  const after = {}
  for (const t of TABLES) after[t] = await countOf(t)
  check('baseline row counts restored', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)
  const { body: strayNotes } = await admin(`notifications?select=id&created_at=gte.${encodeURIComponent(runStartedAt)}&title=like.*Probe 077*`)
  check('no probe notifications left', (strayNotes ?? []).length === 0)
  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('forbidden host and booking untouched', JSON.stringify(fHostBefore) === JSON.stringify(fHostAfter) && JSON.stringify(fBookingBefore) === JSON.stringify(fBookingAfter))
  done()
}
