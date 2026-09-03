// Rentivo — Task 8 verification: notifyNewMessage() recipient resolution.
//
// email.ts's `import 'server-only'` throws when imported from a plain node
// process (it's a bundler-condition marker, not a real no-op outside
// webpack), so the resolution logic can't be called directly from this
// script. Per the task brief's second option, this drives the real
// `POST /api/messages/notify` route against a real production build on
// port 3100 (documented pattern in this repo — see AGENTS.md's e2e note),
// and asserts on the dev-server log line rather than on delivery.
//
// Why the log line proves RECIPIENT RESOLUTION rather than send outcome:
// notifyNewMessage() logs
//   "[email] skipped new-message email — notify_messages off for recipient <id>"
// only when `notify_messages` is false for the resolved recipient — and it
// resolves the recipient (via the conversation) BEFORE checking that flag.
// So forcing the gate closed for the expected recipient, then reading the
// id back out of that exact log line, proves what the code decided the
// recipient was without ever touching Resend (which would 403 in this
// sandbox for a non-owner address regardless of whether resolution is
// correct — exactly the dependency this approach avoids).
//
// Covers both required cases plus a same-conversation reverse-direction
// check, since all three go through the identical log-based assertion:
//   A) booking-conversation message, renter -> host
//   A') the same conversation, host -> renter (proves "whichever party is
//       NOT the sender", not just "always the host")
//   B) inquiry-conversation message (booking_id null), renter -> host
import { readFileSync, openSync, closeSync, statSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'

const PORT = 3100
const BASE = `http://localhost:${PORT}`
const REPO_ROOT = process.cwd()
const SCRATCH = '/private/tmp/claude-501/-Users-jptaycs-Documents-GitHub-rentivo/45765a5f-c722-4b38-813c-8e4b59e52c6f/scratchpad'
const LOG_PATH = `${SCRATCH}/058-server.log`
const REF = SUPABASE_URL.match(/https?:\/\/([^.]+)\./)[1]
const COOKIE_KEY = `sb-${REF}-auth-token`

async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.text() }
}

async function createProbeUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const json = await res.json()
  if (!json?.id) throw new Error(`could not create throwaway probe account ${email}: ${JSON.stringify(json)}`)
  return json.id
}

async function deleteAuthUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}

// Full sign-in session (access_token + refresh_token + user), not just the
// access token signIn() returns — the SSR cookie storage format is the
// whole Session object, JSON.stringify'd, as auth-js's setItemAsync writes it.
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

// Mirrors @supabase/ssr's cookie chunking (MAX_CHUNK_SIZE = 3180). All
// characters here are ASCII (base64url alphabet), so a plain slice is a
// faithful port with no unicode-boundary edge case to worry about.
function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  const parts = []
  for (let i = 0; i * CHUNK < value.length; i++) {
    parts.push(`${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  }
  return parts.join('; ')
}

async function callNotify(session, messageId) {
  const res = await fetch(`${BASE}/api/messages/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeaderFor(session) },
    body: JSON.stringify({ messageId }),
  })
  return { status: res.status, body: await res.text() }
}

function readLogSince(offset) {
  const buf = readFileSync(LOG_PATH)
  return buf.subarray(offset).toString('utf8')
}

// notifyNewMessage() is fired-and-forgotten by the route (not awaited), so
// the skip line can land a moment after the HTTP response returns. Poll the
// log file rather than a fixed sleep.
async function waitForSkipLine(offsetBefore, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const chunk = readLogSince(offsetBefore)
    const m = chunk.match(/\[email\] skipped new-message email — notify_messages off for recipient ([0-9a-f-]{36})/)
    if (m) return m[1]
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

function currentLogSize() {
  try {
    return statSync(LOG_PATH).size
  } catch {
    return 0
  }
}

const stamp = Date.now()
const cleanup = { messageIds: [], conversationIds: [], bookingIds: [], listingIds: [], profileIds: [] }
let serverProc = null

try {
  // ── Confirm port 3100 is free before restarting ─────────────────────────
  // A failed restart leaves the OLD bundle serving and has already produced
  // one false "verified" result in this repo — check first, don't assume.
  let alreadyUp = false
  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(1000) })
    alreadyUp = true
    console.log(`port ${PORT} unexpectedly already serving (status ${probe.status}) — aborting rather than risk testing a stale bundle`)
  } catch {
    // Nothing listening — expected, proceed.
  }
  if (alreadyUp) throw new Error(`port ${PORT} is not free`)

  // ── Baseline (before creating anything) ─────────────────────────────────
  const baselineBefore = {
    messages: (await admin('messages?select=id&limit=1000')).body.length,
    conversations: (await admin('conversations?select=id&limit=1000')).body.length,
    bookings: (await admin('bookings?select=id&limit=1000')).body.length,
  }
  console.log('baseline before:', JSON.stringify(baselineBefore))

  // ── Start a real production server on 3100 ──────────────────────────────
  mkdirSync(SCRATCH, { recursive: true })
  // Truncate/create the log file fresh.
  closeSync(openSync(LOG_PATH, 'w'))
  const logFd = openSync(LOG_PATH, 'a')
  serverProc = spawn('npm', ['start', '--', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)

  // Wait for it to actually accept connections.
  {
    const deadline = Date.now() + 30000
    let up = false
    while (Date.now() < deadline) {
      try {
        await fetch(BASE, { signal: AbortSignal.timeout(1500) })
        up = true
        break
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    check('production server on port 3100 came up', up)
    if (!up) throw new Error('server did not start')
  }

  // ── Probe accounts + listing ─────────────────────────────────────────────
  const renterEmail = `probe-058-renter-${stamp}@example.com`
  const hostEmail = `probe-058-host-${stamp}@example.com`
  const renterId = await createProbeUser(renterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(renterId)
  const hostId = await createProbeUser(hostEmail, 'ProbePassword1!')
  cleanup.profileIds.push(hostId)

  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 058 Host', notify_messages: true }),
  })
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe 058 Renter', notify_messages: true }),
  })

  const renterSession = await signInFull(renterEmail, 'ProbePassword1!')
  const hostSession = await signInFull(hostEmail, 'ProbePassword1!')

  async function makeListing(title) {
    const row = (await admin('listings', {
      method: 'POST',
      body: JSON.stringify({
        host_id: hostId,
        title, brand: 'Probe', model: '058', category: 'mirrorless',
        description: 'probe', condition: 'good',
        daily_price: 100, security_deposit: 0,
        city: 'Manila', province: 'Metro Manila',
        is_active: true, is_draft: false,
        images: ['https://example.com/x.jpg'],
      }),
    })).body[0]
    cleanup.listingIds.push(row.id)
    return row
  }

  // ── Case A: booking-conversation message, renter -> host ────────────────
  const listingA = await makeListing(`Probe 058 Booking Listing ${stamp}`)

  const pickup = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const ret = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10)
  const bookRes = await rpc(renterSession.access_token, 'create_booking', {
    p_listing_id: listingA.id,
    p_pickup_date: pickup,
    p_return_date: ret,
    p_is_delivery: false,
    p_delivery_address: null,
    p_payment_method: 'test_skip',
    p_renter_notes: null,
    p_promo_code: null,
  })
  check('create_booking succeeds for case A', bookRes.status === 200 || bookRes.status === 201, `status ${bookRes.status} ${bookRes.body.slice(0, 200)}`)
  const bookingA = JSON.parse(bookRes.body)
  cleanup.bookingIds.push(bookingA.id)

  const convoARow = (await admin(`conversations?select=id,booking_id,renter_id,host_id&booking_id=eq.${bookingA.id}`)).body[0]
  check('case A conversation exists with booking_id set (not an inquiry)', !!convoARow && convoARow.booking_id === bookingA.id, JSON.stringify(convoARow))
  const convoAId = convoARow.id
  cleanup.conversationIds.push(convoAId)

  const msgARow = (await admin('messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: convoAId, sender_id: renterId, content: 'Case A: renter -> host probe message' }),
  })).body[0]
  cleanup.messageIds.push(msgARow.id)

  // Force the skip-log path so the resolved recipient is revealed without
  // depending on Resend.
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  let offset = currentLogSize()
  const notifyA = await callNotify(renterSession, msgARow.id)
  check('POST /api/messages/notify accepted case A (renter is the sender)', notifyA.status === 200, `status ${notifyA.status} ${notifyA.body.slice(0, 200)}`)
  const recipientA = await waitForSkipLine(offset)
  check('case A: booking-conversation message resolves recipient to the HOST (counterparty)', recipientA === hostId, `resolved ${recipientA}, expected host ${hostId}`)
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: true }) })

  // ── Case A': same conversation, host -> renter (reverse direction) ──────
  const msgARevRow = (await admin('messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: convoAId, sender_id: hostId, content: 'Case A-reverse: host -> renter probe message' }),
  })).body[0]
  cleanup.messageIds.push(msgARevRow.id)

  await admin(`profiles?id=eq.${renterId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  offset = currentLogSize()
  const notifyARev = await callNotify(hostSession, msgARevRow.id)
  check('POST /api/messages/notify accepted case A-reverse (host is the sender)', notifyARev.status === 200, `status ${notifyARev.status} ${notifyARev.body.slice(0, 200)}`)
  const recipientARev = await waitForSkipLine(offset)
  check('case A-reverse: same conversation, host-sent message resolves recipient to the RENTER (whichever party is NOT the sender, not "always host")', recipientARev === renterId, `resolved ${recipientARev}, expected renter ${renterId}`)
  await admin(`profiles?id=eq.${renterId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: true }) })

  // ── Case B: inquiry-conversation message (booking_id null), renter -> host ──
  const listingB = await makeListing(`Probe 058 Inquiry Listing ${stamp}`)
  const inquiryRes = await rpc(renterSession.access_token, 'create_inquiry', { p_listing_id: listingB.id, p_content: 'Case B: inquiry probe message' })
  check('create_inquiry succeeds for case B', inquiryRes.status === 200, `status ${inquiryRes.status} ${inquiryRes.body.slice(0, 200)}`)
  const convoBId = JSON.parse(inquiryRes.body)
  cleanup.conversationIds.push(convoBId)

  const convoBRow = (await admin(`conversations?select=id,booking_id,renter_id,host_id&id=eq.${convoBId}`)).body[0]
  check('case B conversation has booking_id NULL (a real inquiry)', !!convoBRow && convoBRow.booking_id === null, JSON.stringify(convoBRow))

  const msgBRow = (await admin(`messages?select=id,conversation_id,sender_id&conversation_id=eq.${convoBId}`)).body[0]
  check('case B message exists (inserted by create_inquiry itself)', !!msgBRow && msgBRow.sender_id === renterId, JSON.stringify(msgBRow))
  cleanup.messageIds.push(msgBRow.id)

  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  offset = currentLogSize()
  const notifyB = await callNotify(renterSession, msgBRow.id)
  check('POST /api/messages/notify accepted case B', notifyB.status === 200, `status ${notifyB.status} ${notifyB.body.slice(0, 200)}`)
  const recipientB = await waitForSkipLine(offset)
  check('case B: inquiry-conversation message (booking_id NULL) resolves recipient to the HOST', recipientB === hostId, `resolved ${recipientB}, expected host ${hostId}`)

} catch (e) {
  console.error(e)
  check('script completed without throwing', false, String(e?.stack || e))
} finally {
  if (serverProc) {
    serverProc.kill('SIGTERM')
    // Give it a moment to release the port before this process exits.
    await new Promise((r) => setTimeout(r, 500))
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  for (const id of cleanup.bookingIds) {
    await admin(`availability_blocks?booking_id=eq.${id}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of [...new Set(cleanup.messageIds)]) {
    await admin(`messages?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of [...new Set(cleanup.conversationIds)]) {
    await admin(`messages?conversation_id=eq.${id}`, { method: 'DELETE' })
    await admin(`conversations?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of cleanup.listingIds) {
    await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of cleanup.profileIds) {
    await admin(`profiles?id=eq.${id}`, { method: 'DELETE' })
    await deleteAuthUser(id)
  }

  const baselineAfter = {
    messages: (await admin('messages?select=id&limit=1000')).body.length,
    conversations: (await admin('conversations?select=id&limit=1000')).body.length,
    bookings: (await admin('bookings?select=id&limit=1000')).body.length,
  }
  console.log('baseline after:', JSON.stringify(baselineAfter))
  check('baseline restored: messages=2', baselineAfter.messages === 2, JSON.stringify(baselineAfter))
  check('baseline restored: conversations=17', baselineAfter.conversations === 17, JSON.stringify(baselineAfter))
  check('baseline restored: bookings=17', baselineAfter.bookings === 17, JSON.stringify(baselineAfter))
}

done()
