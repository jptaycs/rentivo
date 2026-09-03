// Rentivo — final fix-wave verification: an inquiry's FIRST message now
// notifies the host.
//
// Bug being verified fixed: create_inquiry() inserts the opening message
// inside the RPC, but InquiryDialog.tsx never posted to
// /api/messages/notify afterward — every SUBSEQUENT reply notifies (via
// useConversation.send()) but the thread's first message never did. Fixed
// by adding notifyInquiryOpened() to InquiryDialog.tsx: after create_inquiry
// returns the conversation id, it reads back the newest message in that
// conversation (as the RENTER, via the anon key — RLS permits the sender to
// read their own conversation's messages) and POSTs its id to
// /api/messages/notify, fire-and-forget.
//
// This script does NOT click a real browser button — it replicates
// InquiryDialog's exact new client-side sequence at the HTTP/RPC level
// (create_inquiry as renter -> select newest message as renter via anon key
// -> POST /api/messages/notify with the renter's forged SSR cookie), which
// is the same level of fidelity this repo's other verify scripts use
// (058-email-recipient.mjs) and is what actually changed: the CLIENT code
// deciding to make that read + that POST, not the route itself (already
// covered by 058).
//
// Recipient resolution is proven via the documented skip-log technique
// (058's approach): notifyNewMessage() resolves the recipient BEFORE
// checking notify_messages, so forcing that gate closed for the host and
// reading the id back out of the resulting skip line proves what the code
// decided the recipient was, without depending on Resend (sandboxed locally
// -> would 403 regardless of whether resolution is correct).
import { readFileSync, openSync, closeSync, statSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'

const FORBIDDEN_HOST_ID = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68' // Isse Capucao — do not touch
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

const PORT = 3100
const BASE = `http://localhost:${PORT}`
const REPO_ROOT = process.cwd()
const SCRATCH = '/private/tmp/claude-501/-Users-jptaycs-Documents-GitHub-rentivo/45765a5f-c722-4b38-813c-8e4b59e52c6f/scratchpad'
const LOG_PATH = `${SCRATCH}/inquiry-first-notify-server.log`
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

// The exact query notifyInquiryOpened() runs, as the renter, via anon key.
async function selectNewestMessageAsUser(token, conversationId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?select=id&conversation_id=eq.${conversationId}&order=created_at.desc&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }
  )
  const body = await res.json()
  return { status: res.status, row: body[0] ?? null }
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
function currentLogSize() {
  try {
    return statSync(LOG_PATH).size
  } catch {
    return 0
  }
}
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

const stamp = Date.now()
const cleanup = { messageIds: [], conversationIds: [], listingIds: [], profileIds: [] }
let serverProc = null

try {
  // ── Confirm port 3100 is free before starting — a failed restart leaves
  // the OLD bundle serving and has produced a false "verified" in this repo.
  let alreadyUp = false
  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(1000) })
    alreadyUp = true
    console.log(`port ${PORT} unexpectedly already serving (status ${probe.status}) — aborting rather than risk testing a stale bundle`)
  } catch {
    // Nothing listening — expected, proceed.
  }
  if (alreadyUp) throw new Error(`port ${PORT} is not free`)

  const baselineBefore = {
    messages: (await admin('messages?select=id&limit=1000')).body.length,
    conversations: (await admin('conversations?select=id&limit=1000')).body.length,
    bookings: (await admin('bookings?select=id&limit=1000')).body.length,
    listings: (await admin('listings?select=id&limit=1000')).body.length,
    profiles: (await admin('profiles?select=id&limit=1000')).body.length,
  }
  console.log('baseline before:', JSON.stringify(baselineBefore))

  mkdirSync(SCRATCH, { recursive: true })
  closeSync(openSync(LOG_PATH, 'w'))
  const logFd = openSync(LOG_PATH, 'a')
  serverProc = spawn('npm', ['start', '--', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)

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

  // ── Probe accounts + listing (never the demo/forbidden accounts) ────────
  const renterEmail = `probe-firstnotify-renter-${stamp}@example.com`
  const hostEmail = `probe-firstnotify-host-${stamp}@example.com`
  const renterId = await createProbeUser(renterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(renterId)
  const hostId = await createProbeUser(hostEmail, 'ProbePassword1!')
  cleanup.profileIds.push(hostId)
  check('probe host id is not the forbidden host', hostId !== FORBIDDEN_HOST_ID)

  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe FirstNotify Host', notify_messages: true }),
  })
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe FirstNotify Renter', notify_messages: true }),
  })

  const renterSession = await signInFull(renterEmail, 'ProbePassword1!')

  const listingRow = (await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId,
      title: `Probe FirstNotify Listing ${stamp}`, brand: 'Probe', model: 'FirstNotify',
      category: 'mirrorless', description: 'probe', condition: 'good',
      daily_price: 100, security_deposit: 0,
      city: 'Manila', province: 'Metro Manila',
      is_active: true, is_draft: false,
      images: ['https://example.com/x.jpg'],
    }),
  })).body[0]
  cleanup.listingIds.push(listingRow.id)

  // ── This is InquiryDialog's exact new sequence, replicated at the
  // HTTP/RPC level ───────────────────────────────────────────────────────

  // 1) create_inquiry, as the renter — inserts the conversation + opening
  //    message inside the RPC (unchanged, pre-existing behaviour).
  const inquiryRes = await rpc(renterSession.access_token, 'create_inquiry', {
    p_listing_id: listingRow.id,
    p_content: 'Hi! Is this available next weekend? (first-notify probe)',
  })
  check('create_inquiry succeeds', inquiryRes.status === 200, `status ${inquiryRes.status} ${inquiryRes.body.slice(0, 200)}`)
  const conversationId = JSON.parse(inquiryRes.body)
  cleanup.conversationIds.push(conversationId)

  const convoRow = (await admin(`conversations?select=id,booking_id,renter_id,host_id&id=eq.${conversationId}`)).body[0]
  check('conversation is a real inquiry (booking_id null)', !!convoRow && convoRow.booking_id === null, JSON.stringify(convoRow))
  check('conversation host_id resolves to the probe host', convoRow?.host_id === hostId, JSON.stringify(convoRow))

  // 2) The NEW code: read back the newest message in that conversation, as
  //    the renter, via the anon key (RLS-scoped — not the admin client).
  const { status: readStatus, row: msgRow } = await selectNewestMessageAsUser(renterSession.access_token, conversationId)
  check('renter can read back the opening message via anon key (RLS)', readStatus === 200 && !!msgRow, `status ${readStatus} row ${JSON.stringify(msgRow)}`)
  if (msgRow) cleanup.messageIds.push(msgRow.id)

  // 3) The NEW code: POST that message id to /api/messages/notify, exactly
  //    like useConversation.send() does for every later reply.
  //
  // Force the skip-log path (host notify_messages off) so the resolved
  // recipient is revealed in the dev-server log without depending on Resend
  // (sandboxed locally — see AGENTS.md).
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  let offset = currentLogSize()
  const notifyRes = await callNotify(renterSession, msgRow.id)
  check('POST /api/messages/notify accepts the inquiry-opening message (renter is the sender)', notifyRes.status === 200, `status ${notifyRes.status} ${notifyRes.body.slice(0, 200)}`)
  const resolvedRecipient = await waitForSkipLine(offset)
  check(
    "an inquiry's FIRST message resolves notifyNewMessage()'s recipient to the HOST",
    resolvedRecipient === hostId,
    `resolved ${resolvedRecipient}, expected host ${hostId}`
  )

  // ── Also prove the normal (not-forced-off) path is reachable: with
  // notify_messages back on, notifyNewMessage() should proceed past the
  // gate and attempt a real send (which 403s in this sandbox — expected,
  // and not what's being asserted here; only that resolution + the gate
  // check both pass through cleanly with no thrown error). ───────────────
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: true }) })
  offset = currentLogSize()
  const notifyRes2 = await callNotify(renterSession, msgRow.id)
  check('POST /api/messages/notify still returns 200 with notify_messages back on (idempotent re-notify of the same message)', notifyRes2.status === 200, `status ${notifyRes2.status} ${notifyRes2.body.slice(0, 200)}`)
  await new Promise((r) => setTimeout(r, 1500))
  const afterOn = readLogSince(offset)
  check('no skip line when notify_messages is on (gate correctly not applied)', !afterOn.includes('skipped new-message email'), afterOn.slice(0, 300))

} catch (e) {
  console.error(e)
  check('script completed without throwing', false, String(e?.stack || e))
} finally {
  if (serverProc) {
    serverProc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
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
    listings: (await admin('listings?select=id&limit=1000')).body.length,
    profiles: (await admin('profiles?select=id&limit=1000')).body.length,
  }
  console.log('baseline after:', JSON.stringify(baselineAfter))
  check('baseline restored: messages=2', baselineAfter.messages === 2, JSON.stringify(baselineAfter))
  check('baseline restored: conversations=17', baselineAfter.conversations === 17, JSON.stringify(baselineAfter))
  check('baseline restored: bookings=17', baselineAfter.bookings === 17, JSON.stringify(baselineAfter))
  check('baseline restored: listings=25', baselineAfter.listings === 25, JSON.stringify(baselineAfter))
  check('baseline restored: profiles=24', baselineAfter.profiles === 24, JSON.stringify(baselineAfter))

  const forbiddenBooking = (await admin(`bookings?select=id,booking_ref,status,payment_status&booking_ref=eq.${FORBIDDEN_BOOKING_CODE}`)).body[0]
  console.log('forbidden booking still present/untouched:', JSON.stringify(forbiddenBooking))
  check('forbidden booking RNT-A4DA55 still exists', !!forbiddenBooking)
}

done()
