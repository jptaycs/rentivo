// Verifies migration 076 (rate limiting in Postgres) and the once-only
// new-message email claim in /api/messages/notify.
//
// Every authorisation claim uses a REAL signed-in session (anon key + user
// JWT, or a forged SSR cookie for the Next routes). The service role is used
// only for setup, independent re-reads, the service-role-exemption check and
// cleanup. Every refusal is paired with a CONTROL that proves the identical
// request succeeds when the condition under test is absent.
//
// Starts its own production server on port 3100 (never 3000 — another
// project), with RESEND_API_KEY blanked so no real email is sent: the proof is
// the notified_at claim, not delivery. Run `npm run build` first.
//
// Throwaway accounts/listing only, plus one message from the demo renter to
// the demo host (deleted afterwards, conversation timestamp restored).
//
// Usage: node scripts/verify/076-rate-limiting.mjs
import { spawn, execSync } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PORT = 3100
const BASE = `http://localhost:${PORT}`
const REF = SUPABASE_URL.match(/https?:\/\/([^.]+)\./)[1]
const COOKIE_KEY = `sb-${REF}-auth-token`
const PW = 'ProbeRentivo1'
const MSG_LIMIT_TEXT = 'You are sending messages too quickly. Please wait a moment and try again.'
const BOOKING_LIMIT_TEXT = 'You have made too many booking requests in the last hour. Please wait a while and try again.'

const stamp = Date.now()
const created = { users: [], listings: [], bookings: [], messages: [], conversations: [], keys: [] }
let serverProc = null
let demoConvo = null

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  return j.id
}
const hardDeleteUser = (id) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })

async function session(email, password = PW) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error(`sign-in failed for ${email}`)
  return j
}
function cookieHeaderFor(s) {
  const value = 'base64-' + Buffer.from(JSON.stringify(s), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  const parts = []
  for (let i = 0; i * CHUNK < value.length; i++) parts.push(`${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  return parts.join('; ')
}
async function route(s, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeaderFor(s) },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json, retryAfter: res.headers.get('retry-after') }
}
async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: token === SECRET ? SECRET : ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const denied = (r) => [401, 403].includes(r.status) && JSON.stringify(r.body).toLowerCase().includes('permission denied')
const hitCount = async (key) => (await admin(`rate_limit_hits?select=key&key=eq.${encodeURIComponent(key)}`)).body.length

async function cleanup() {
  for (const id of created.messages) await admin(`messages?id=eq.${id}`, { method: 'DELETE' })
  if (demoConvo) {
    await admin(`conversations?id=eq.${demoConvo.id}`, {
      method: 'PATCH', body: JSON.stringify({ last_message_at: demoConvo.last_message_at }),
    })
  }
  for (const id of created.bookings) await admin(`bookings?id=eq.${id}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`messages?sender_id=eq.${u}`, { method: 'DELETE' })
    await admin(`bookings?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
  }
  for (const id of created.listings) await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`rate_limit_hits?key=like.*:${u}`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }
  for (const k of created.keys) await admin(`rate_limit_hits?key=like.${encodeURIComponent(k)}`, { method: 'DELETE' })
}

try {
  // ── port 3100 must be free (a stale server would test an old bundle) ─────
  let busy = false
  try { await fetch(BASE, { signal: AbortSignal.timeout(1000) }); busy = true } catch {}
  if (busy) throw new Error(`port ${PORT} is already serving — stop it first`)
  serverProc = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env: { ...process.env, RESEND_API_KEY: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  {
    const deadline = Date.now() + 40000
    let up = false
    while (Date.now() < deadline) {
      try { await fetch(BASE, { signal: AbortSignal.timeout(1500) }); up = true; break } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    if (!up) throw new Error('server did not start')
  }

  const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  const countOf = async (t) => (await admin(`${t}?select=id&limit=100000`)).body.length
  const before = { bookings: await countOf('bookings'), messages: await countOf('messages'), conversations: await countOf('conversations') }

  // ── setup: throwaway host + listing, three throwaway users ───────────────
  const hostEmail = `probe-076-host-${stamp}@example.com`
  const hostId = await createUser(hostEmail)
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ full_name: 'Probe 076 Host', is_host: true, is_verified: true }) })
  const renterAEmail = `probe-076-a-${stamp}@example.com`
  const renterAId = await createUser(renterAEmail)
  const renterBEmail = `probe-076-b-${stamp}@example.com`
  const renterBId = await createUser(renterBEmail)
  const { body: listingRows } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, title: `Probe 076 Listing ${stamp}`, brand: 'Sony', model: 'A7 IV',
      category: 'mirrorless', condition: 'excellent', description: 'Probe listing for 076.',
      daily_price: 1000, security_deposit: 0, delivery_fee: null, city: 'Manila', province: 'Metro Manila',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false, latitude: 14.5995, longitude: 120.9842, location_is_exact: true,
    }),
  })
  const listingId = listingRows[0].id
  created.listings.push(listingId)
  const hostS = await session(hostEmail)
  const aS = await session(renterAEmail)
  const bS = await session(renterBEmail)

  // ════ 1. notify is once-only ═════════════════════════════════════════════
  const demoRenterS = await session('renter@demo.rentivo.ph', 'DemoRentivo1')
  const demoHostS = await session('demo@demo.rentivo.ph', 'DemoRentivo1')
  const demoRenterId = demoRenterS.user.id
  const demoHostId = demoHostS.user.id
  const { body: convos } = await admin(
    `conversations?select=id,last_message_at,host_id&renter_id=eq.${demoRenterId}&host_id=eq.${demoHostId}&order=created_at.asc&limit=1`
  )
  demoConvo = convos[0]
  if (!demoConvo) throw new Error('no demo renter <-> demo host conversation')

  const sent = await asUser(demoRenterS.access_token, 'messages?select=id,notified_at', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: demoConvo.id, sender_id: demoRenterId, content: `076 probe ${stamp}`, notified_at: '2020-01-01T00:00:00Z' }),
  })
  const msgId = sent.body?.[0]?.id
  if (msgId) created.messages.push(msgId)
  check('8. normal single message from demo renter succeeds', sent.status === 201 && !!msgId, `${sent.status}`)
  check('client insert cannot pre-set notified_at (trigger forces null)', sent.body?.[0]?.notified_at === null, JSON.stringify(sent.body))

  const hostCall = await route(demoHostS, '/api/messages/notify', { messageId: msgId })
  let { body: [row0] } = await admin(`messages?select=notified_at&id=eq.${msgId}`)
  check('sender check first: non-sender (demo host) gets 404 and claims nothing', hostCall.status === 404 && row0.notified_at === null, `${hostCall.status}`)

  const clientUpdate = await asUser(demoRenterS.access_token, `messages?id=eq.${msgId}`, {
    method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }),
  })
  check('client cannot UPDATE notified_at (permission denied)', denied(clientUpdate), `${clientUpdate.status} ${JSON.stringify(clientUpdate.body)}`)

  const first = await route(demoRenterS, '/api/messages/notify', { messageId: msgId })
  const { body: [row1] } = await admin(`messages?select=notified_at&id=eq.${msgId}`)
  check('first notify call claims notified_at', first.status === 200 && first.body?.ok === true && !first.body?.alreadyNotified && row1.notified_at !== null, `${first.status} ${JSON.stringify(first.body)} ${row1.notified_at}`)
  const second = await route(demoRenterS, '/api/messages/notify', { messageId: msgId })
  const { body: [row2] } = await admin(`messages?select=notified_at&id=eq.${msgId}`)
  check('second notify call does NOT claim again (alreadyNotified, timestamp unchanged)',
    second.status === 200 && second.body?.alreadyNotified === true && row2.notified_at === row1.notified_at,
    `${JSON.stringify(second.body)} ${row1.notified_at} -> ${row2.notified_at}`)

  // ════ 2. rate_limit_consume is atomic ════════════════════════════════════
  const N = 10
  const atomicKey = `verify076:atomic:${stamp}`
  created.keys.push(atomicKey)
  const results = await Promise.all(
    Array.from({ length: N + 5 }, () => rpc(SECRET, 'rate_limit_consume', { p_key: atomicKey, p_max: N, p_window_seconds: 60 }))
  )
  const trues = results.filter((r) => r.status === 200 && r.body === true).length
  const falses = results.filter((r) => r.status === 200 && r.body === false).length
  check(`${N + 5} concurrent consumes with max=${N}: exactly ${N} true`, trues === N && falses === 5, `true=${trues} false=${falses}`)
  check('exactly N hit rows stored', (await hitCount(atomicKey)) === N)

  // ════ 3. message trigger: per sender ═════════════════════════════════════
  const { body: [convoA] } = await admin('conversations', {
    method: 'POST', body: JSON.stringify({ listing_id: listingId, renter_id: renterAId, host_id: hostId }),
  })
  created.conversations.push(convoA.id)
  const insertMsg = (s, senderId, content) => asUser(s.access_token, 'messages?select=id', {
    method: 'POST', body: JSON.stringify({ conversation_id: convoA.id, sender_id: senderId, content }),
  })
  let okCount = 0
  for (let i = 0; i < 30; i++) {
    const r = await insertMsg(aS, renterAId, `burst ${i}`)
    if (r.status === 201) { okCount++; created.messages.push(r.body[0].id) }
  }
  check('CONTROL: first 30 messages in a minute from one sender succeed', okCount === 30, `${okCount}/30`)
  const m31 = await insertMsg(aS, renterAId, 'burst 31')
  check('31st message from the same sender is refused with the readable message',
    m31.status >= 400 && m31.body?.message === MSG_LIMIT_TEXT, `${m31.status} ${JSON.stringify(m31.body)}`)
  const hostReply = await insertMsg(hostS, hostId, 'host reply at the same moment')
  if (hostReply.status === 201) created.messages.push(hostReply.body[0].id)
  check('CONTROL: a different sender in the same conversation at the same moment is NOT refused', hostReply.status === 201, `${hostReply.status}`)

  // ════ 5a. service role exempt (messages) ═════════════════════════════════
  const srMsg = await admin('messages?select=id', {
    method: 'POST', body: JSON.stringify({ conversation_id: convoA.id, sender_id: renterAId, content: 'service role past the limit' }),
  })
  if (srMsg.status === 201) created.messages.push(srMsg.body[0].id)
  check('service-role message insert for an over-limit sender succeeds', srMsg.status === 201, `${srMsg.status} ${JSON.stringify(srMsg.body)}`)
  const m32 = await insertMsg(aS, renterAId, 'still limited?')
  check('CONTROL: that sender is still limited right after the service-role insert', m32.body?.message === MSG_LIMIT_TEXT, `${m32.status}`)

  // ════ 4. booking trigger: 10 per renter per hour ═════════════════════════
  const book = (s, i) => rpc(s.access_token, 'create_booking', {
    p_listing_id: listingId,
    p_pickup_date: new Date(Date.UTC(2027, 5, 1 + i * 3)).toISOString().slice(0, 10),
    p_return_date: new Date(Date.UTC(2027, 5, 2 + i * 3)).toISOString().slice(0, 10),
    p_is_delivery: false, p_delivery_address: null, p_payment_method: 'qrph', p_promo_code: null, p_renter_notes: null,
  })
  let bookOk = 0
  let lastOk = null
  for (let i = 0; i < 10; i++) {
    const r = await book(aS, i)
    if (r.status === 200 && r.body?.id) { bookOk++; created.bookings.push(r.body.id); lastOk = r.body }
    else console.log('   booking', i + 1, r.status, JSON.stringify(r.body))
  }
  check('CONTROL: bookings 1-10 inside an hour succeed (the 10th included)', bookOk === 10, `${bookOk}/10`)
  const b11 = await book(aS, 10)
  if (b11.body?.id) created.bookings.push(b11.body.id)
  check('11th booking inside an hour for one renter is refused with the readable message',
    b11.status >= 400 && b11.body?.message === BOOKING_LIMIT_TEXT, `${b11.status} ${JSON.stringify(b11.body)}`)

  // ════ 5b. service role exempt (bookings) ═════════════════════════════════
  if (lastOk) {
    const { id, booking_ref, created_at, updated_at, total_days, ...rest } = lastOk
    void id; void booking_ref; void created_at; void updated_at; void total_days
    const srBook = await admin('bookings?select=id', {
      method: 'POST', body: JSON.stringify({ ...rest, pickup_date: '2027-09-01', return_date: '2027-09-02' }),
    })
    if (srBook.status === 201) created.bookings.push(srBook.body[0].id)
    check('service-role booking insert for an over-limit renter succeeds', srBook.status === 201, `${srBook.status} ${JSON.stringify(srBook.body)}`)
  }

  // ════ 8. normal single booking (a different renter) ══════════════════════
  const bOne = await book(bS, 20)
  if (bOne.body?.id) created.bookings.push(bOne.body.id)
  check('8. normal single booking (different renter, same moment) succeeds', bOne.status === 200 && !!bOne.body?.id, `${bOne.status} ${JSON.stringify(bOne.body).slice(0, 200)}`)

  // ════ 6. route limit: checkout 10 / 10 min ═══════════════════════════════
  // Empty body: the limiter runs before validation, so no booking or PayMongo
  // intent is ever created by these calls.
  let pre = []
  for (let i = 0; i < 10; i++) pre.push((await route(aS, '/api/payments/checkout', {})).status)
  check('CONTROL: first 10 checkout calls are not throttled', pre.every((s) => s === 400), pre.join(','))
  const c11 = await route(aS, '/api/payments/checkout', {})
  check('11th checkout call returns 429 with Retry-After and a readable message',
    c11.status === 429 && c11.retryAfter === '600' && /Too many attempts/.test(c11.body?.error ?? ''), `${c11.status} ${c11.retryAfter} ${JSON.stringify(c11.body)}`)
  const cOther = await route(bS, '/api/payments/checkout', {})
  check('CONTROL: a different user is unaffected', cOther.status === 400, `${cOther.status}`)

  // Wiring of the other three limited routes: one call each lands a hit.
  const fakeId = '00000000-0000-4000-8000-000000000000'
  const rResp = await route(bS, `/api/bookings/${fakeId}/respond`, { status: 'confirmed' })
  check('respond route is limited (hit recorded, request not throttled)', rResp.status !== 429 && (await hitCount(`respond:${renterBId}`)) === 1, `${rResp.status}`)
  const rVer = await route(bS, `/api/bookings/${fakeId}/verify-payment`, {})
  check('verify-payment route is limited (hit recorded, request not throttled)', rVer.status !== 429 && (await hitCount(`verify-payment:${renterBId}`)) === 1, `${rVer.status}`)

  // ════ 7. grants ═════════════════════════════════════════════════════════
  for (const [label, tok] of [['anon', null], ['authenticated', aS.access_token]]) {
    const read = await asUser(tok, 'rate_limit_hits?select=key&limit=1')
    check(`${label} cannot read rate_limit_hits (permission denied)`, denied(read), `${read.status} ${JSON.stringify(read.body)}`)
    const write = await asUser(tok, 'rate_limit_hits', { method: 'POST', body: JSON.stringify({ key: `x:${renterAId}` }) })
    check(`${label} cannot insert into rate_limit_hits (permission denied)`, denied(write), `${write.status} ${JSON.stringify(write.body)}`)
    const del = await asUser(tok, `rate_limit_hits?key=eq.checkout:${renterAId}`, { method: 'DELETE' })
    check(`${label} cannot delete its own rate_limit_hits (permission denied)`, denied(del), `${del.status} ${JSON.stringify(del.body)}`)
    const exec = await rpc(tok, 'rate_limit_consume', { p_key: `x:${stamp}`, p_max: 1, p_window_seconds: 60 })
    check(`${label} cannot execute rate_limit_consume (permission denied)`, denied(exec), `${exec.status} ${JSON.stringify(exec.body)}`)
  }
  check('CONTROL: service role CAN read rate_limit_hits', (await hitCount(`checkout:${renterAId}`)) === 10)

  // ════ account deletion purges rate_limit_hits ════════════════════════════
  const del = await route(bS, '/api/account/delete', { confirm: 'DELETE' })
  // renter B holds a pending booking (bOne), so deletion is gated; cancel it first.
  if (del.status === 400) {
    await admin(`bookings?id=eq.${bOne.body.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  }
  const bHitsBefore = (await admin(`rate_limit_hits?select=key&key=like.*:${renterBId}`)).body.length
  const del2 = await route(bS, '/api/account/delete', { confirm: 'DELETE' })
  const bHitsAfter = (await admin(`rate_limit_hits?select=key&key=like.*:${renterBId}`)).body.length
  check('account deletion purges the user\'s rate_limit_hits (incl. its own account-delete hit)',
    del2.status === 200 && bHitsBefore > 0 && bHitsAfter === 0, `${del2.status} ${bHitsBefore} -> ${bHitsAfter}`)

  // ── cleanup + proof ──────────────────────────────────────────────────────
  await cleanup()
  await admin(`rate_limit_hits?key=like.*:${demoRenterId}`, { method: 'DELETE' })
  const after = { bookings: await countOf('bookings'), messages: await countOf('messages'), conversations: await countOf('conversations') }
  check('bookings/messages/conversations back at baseline', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  const leftovers = []
  for (const u of [...created.users, demoRenterId]) leftovers.push(...(await admin(`rate_limit_hits?select=key&key=like.*:${u}`)).body)
  leftovers.push(...(await admin(`rate_limit_hits?select=key&key=like.verify076:*`)).body)
  check('no rate_limit_hits rows left for any probe key', leftovers.length === 0, JSON.stringify(leftovers))
  const leftoverNotifs = []
  for (const u of created.users) leftoverNotifs.push(...(await admin(`notifications?select=id&user_id=eq.${u}`)).body)
  check('no probe notifications left', leftoverNotifs.length === 0)
  check('probe message deleted', (await admin(`messages?select=id&id=eq.${msgId}`)).body.length === 0)
  const { body: [convoAfter] } = await admin(`conversations?select=last_message_at&id=eq.${demoConvo.id}`)
  check('demo conversation last_message_at restored', convoAfter.last_message_at === demoConvo.last_message_at)
  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('forbidden host and booking untouched', JSON.stringify(fHostBefore) === JSON.stringify(fHostAfter) && JSON.stringify(fBookingBefore) === JSON.stringify(fBookingAfter))
  created.users = []; created.messages = []; created.bookings = []; created.listings = []; created.keys = []; demoConvo = null
} catch (e) {
  console.error('SCRIPT ERROR:', e)
  check('script ran to completion', false, e.message)
  await cleanup().catch(() => {})
} finally {
  if (serverProc) {
    serverProc.kill('SIGTERM')
    try { execSync(`lsof -t -iTCP:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null`) } catch {}
  }
}
done()
