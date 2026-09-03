// Rentivo — Task 10: full live verification of the pre-booking-inquiries
// system (migrations 049-056) as ONE end-to-end whole, not per-migration.
//
// Every authorisation assertion goes through asUser() — a real anon-key
// request with a real signed-in session's JWT. admin() (service role) is
// used ONLY for setup, independent state re-reads, and cleanup; it bypasses
// RLS entirely and proves nothing about access control.
//
// Two traps this run is built to avoid (see the task brief):
//   1. Ordering can manufacture a false pass — e.g. testing a `?booking=`
//      deep-link resolution AFTER sending a message into that conversation,
//      when the send itself is what made it resolve. Every "does X already
//      work before Y happens" check below is ordered so nothing upstream
//      creates the precondition being tested.
//   2. A refusal can come from the wrong branch — e.g. a probe listing that
//      is accidentally drafted (unverified host, migration 037) makes
//      create_inquiry refuse at the draft branch instead of the branch under
//      test, and both raise the identical message. Every refusal check below
//      has a CONTROL assertion proving the same call succeeds before the
//      condition being tested is applied, so the refusal is attributable.
import { readFileSync, openSync, closeSync, statSync, mkdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST_ID = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68' // Isse Capucao — do not touch
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

const PORT = 3100
const BASE = `http://localhost:${PORT}`
const REPO_ROOT = process.cwd()
const SCRATCH = '/private/tmp/claude-501/-Users-jptaycs-Documents-GitHub-rentivo/45765a5f-c722-4b38-813c-8e4b59e52c6f/scratchpad'
const LOG_PATH = `${SCRATCH}/full-inquiries-server.log`
const REF = SUPABASE_URL.match(/https?:\/\/([^.]+)\./)[1]
const COOKIE_KEY = `sb-${REF}-auth-token`

const stamp = Date.now()
const cleanup = {
  messageIds: [],
  conversationIds: [],
  bookingIds: [],
  listingIds: [],
  profileIds: [],
  // { table, id, field, value } — non-destructive restores of real rows this
  // run had to touch (e.g. the demo accounts' notify_messages toggle).
  restores: [],
}
let serverProc = null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Full sign-in session (access_token + refresh_token + user), needed for the
// forged-SSR-cookie pattern this repo documents for driving real Next.js
// API routes (see AGENTS.md's "E2E test pattern").
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

// Mirrors @supabase/ssr's cookie chunking (MAX_CHUNK_SIZE = 3180).
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

async function makeListing(hostId, overrides = {}) {
  const row = (await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId,
      title: `Probe FullInquiries Listing ${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      brand: 'Probe', model: 'FI', category: 'mirrorless',
      description: 'probe', condition: 'good',
      daily_price: 100, security_deposit: 0,
      city: 'Manila', province: 'Metro Manila',
      is_active: true, is_draft: false,
      images: ['https://example.com/x.jpg'],
      ...overrides,
    }),
  })).body[0]
  cleanup.listingIds.push(row.id)
  return row
}

async function bookListing(token, listingId, dayOffset) {
  const pickup = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10)
  const ret = new Date(Date.now() + (dayOffset + 3) * 86400000).toISOString().slice(0, 10)
  return rpc(token, 'create_booking', {
    p_listing_id: listingId,
    p_pickup_date: pickup,
    p_return_date: ret,
    p_is_delivery: false,
    p_delivery_address: null,
    p_payment_method: 'test_skip',
    p_renter_notes: null,
    p_promo_code: null,
  })
}

async function jwtSub(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  return payload.sub
}

// Runs a raw SQL query against the linked hosted database via the Supabase
// CLI (there is no PostgREST equivalent for system-catalog queries like
// pg_class/information_schema — this is the same tool migration 017's grant
// audit was originally run with). Folded into the script itself, rather than
// left as an ad hoc terminal command only prose attests to, so a rerun of
// this file is itself the evidence.
function dbQuery(sql) {
  const res = spawnSync('supabase', ['db', 'query', '--linked', '--output-format', 'json', sql], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    throw new Error(`supabase db query failed (exit ${res.status}): ${res.stderr || res.stdout}`)
  }
  return JSON.parse(res.stdout).rows
}

async function main() {
  // ── Baseline (before anything) ─────────────────────────────────────────
  const baselineBefore = {
    conversations: (await admin('conversations?select=id&limit=2000')).body.length,
    messages: (await admin('messages?select=id&limit=2000')).body.length,
    bookings: (await admin('bookings?select=id&limit=2000')).body.length,
    listings: (await admin('listings?select=id&limit=2000')).body.length,
    profiles: (await admin('profiles?select=id&limit=2000')).body.length,
  }
  console.log('baseline before:', JSON.stringify(baselineBefore))
  check('baseline before matches the recorded state (conversations=17, messages=2, bookings=17)',
    baselineBefore.conversations === 17 && baselineBefore.messages === 2 && baselineBefore.bookings === 17,
    JSON.stringify(baselineBefore))

  // ── Start a real production server on port 3100 ─────────────────────────
  // Confirm the port is actually free BEFORE starting — a failed restart
  // leaves the OLD bundle serving and any "verification" then measures
  // pre-fix code (documented false-positive risk in this repo).
  let alreadyUp = false
  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(1000) })
    alreadyUp = true
    console.log(`port ${PORT} unexpectedly already serving (status ${probe.status})`)
  } catch {
    // Nothing listening — expected.
  }
  check('port 3100 was free before starting the server', !alreadyUp)
  if (alreadyUp) throw new Error('port 3100 is not free — aborting rather than test a stale bundle')

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
    if (!up) {
      const log = readLogSince(0)
      throw new Error(`server did not start. Log tail:\n${log.slice(-2000)}`)
    }
    const log = readLogSince(0)
    check('server log has no EADDRINUSE', !/EADDRINUSE/.test(log), log.slice(0, 500))
  }

  const hostTok = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
  const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
  const hostId = await jwtSub(hostTok)
  const renterId = await jwtSub(renterTok)

  // =========================================================================
  // SCENARIO 1 — existing booking thread: both directions, read receipts,
  // Realtime.
  // =========================================================================
  console.log('\n=== SCENARIO 1: existing booking thread ===')

  const bookings = (await admin('bookings?select=id,renter_id,host_id,listing_id,booking_ref&limit=200')).body
  const usableBookings = bookings.filter((b) =>
    b.renter_id && b.host_id && b.host_id !== FORBIDDEN_HOST_ID && b.booking_ref !== FORBIDDEN_BOOKING_CODE)
  const existingBooking = usableBookings[0]
  if (!existingBooking) throw new Error('no usable existing booking found (excluding the forbidden host/booking)')
  console.log(`using existing booking ${existingBooking.id} (${existingBooking.booking_ref})`)

  const existingConvo = (await admin(`conversations?select=id,last_message_at&booking_id=eq.${existingBooking.id}`)).body[0]
  if (!existingConvo) throw new Error(`booking ${existingBooking.id} has no conversation row`)
  const existingConvoId = existingConvo.id
  const existingConvoOriginalLastMessageAt = existingConvo.last_message_at

  // Which real accounts are the two parties? Sign in to those specific
  // accounts is not possible (no known passwords for arbitrary hosts), so
  // this scenario is only runnable when the existing booking's parties are
  // the demo accounts. Fall back to seeding a throwaway booking between the
  // demo accounts if not — but check the common case first.
  let s1RenterTok = renterTok, s1HostTok = hostTok, s1ConvoId = existingConvoId
  let s1ConvoOriginalLastMessageAt = existingConvoOriginalLastMessageAt
  let s1IsThrowaway = false
  if (existingBooking.renter_id !== renterId || existingBooking.host_id !== hostId) {
    // The chosen existing booking doesn't belong to the demo accounts (only
    // their credentials are known to this script) — find one that does, or
    // seed a fresh demo-to-demo booking as a last resort. Seeding one here
    // still exercises "an existing booking thread" once created — it is not
    // pre-booking-inquiry state, but scenario 4/5 already cover the
    // create-then-attach path, so this stays a faithful test of "booking
    // thread messaging" on its own.
    const demoBooking = usableBookings.find((b) => b.renter_id === renterId && b.host_id === hostId)
    if (demoBooking) {
      const c = (await admin(`conversations?select=id,last_message_at&booking_id=eq.${demoBooking.id}`)).body[0]
      s1ConvoId = c.id
      s1ConvoOriginalLastMessageAt = c.last_message_at
      console.log(`existing booking ${existingBooking.id} isn't between the demo accounts — using demo-to-demo booking ${demoBooking.id} instead`)
    } else {
      s1IsThrowaway = true
      const s1Listing = await makeListing(hostId)
      const s1Book = await bookListing(renterTok, s1Listing.id, 90)
      check('scenario 1 fallback: seeded a fresh demo-to-demo booking', s1Book.status === 200 || s1Book.status === 201, s1Book.body)
      const s1BookRow = JSON.parse(s1Book.body)
      cleanup.bookingIds.push(s1BookRow.id)
      const c = (await admin(`conversations?select=id,last_message_at&booking_id=eq.${s1BookRow.id}`)).body[0]
      s1ConvoId = c.id
      s1ConvoOriginalLastMessageAt = c.last_message_at
      console.log(`no existing demo-to-demo booking found — seeded ${s1BookRow.id} instead`)
    }
  }

  // If s1ConvoId is a REAL, pre-existing conversation (not one this run
  // seeded and will delete outright via cascade on its throwaway booking),
  // queue a restore of last_message_at — the AFTER INSERT trigger will bump
  // it on every probe message this scenario sends.
  if (!s1IsThrowaway) {
    cleanup.restores.push({ table: 'conversations', id: s1ConvoId, field: 'last_message_at', value: s1ConvoOriginalLastMessageAt })
  }

  // -- renter -> host --
  const s1MsgRenter = await asUser(s1RenterTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: s1ConvoId, sender_id: renterId, content: `full-inquiries s1 renter->host ${stamp}` }),
  })
  const s1MsgRenterRow = Array.isArray(s1MsgRenter.body) ? s1MsgRenter.body[0] : null
  if (s1MsgRenterRow?.id) cleanup.messageIds.push(s1MsgRenterRow.id)
  check('renter can send into an existing booking thread', s1MsgRenter.status === 201, `status ${s1MsgRenter.status} ${JSON.stringify(s1MsgRenter.body).slice(0, 200)}`)

  // -- host -> renter --
  const s1MsgHost = await asUser(s1HostTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: s1ConvoId, sender_id: hostId, content: `full-inquiries s1 host->renter ${stamp}` }),
  })
  const s1MsgHostRow = Array.isArray(s1MsgHost.body) ? s1MsgHost.body[0] : null
  if (s1MsgHostRow?.id) cleanup.messageIds.push(s1MsgHostRow.id)
  check('host can send into the same existing booking thread', s1MsgHost.status === 201, `status ${s1MsgHost.status} ${JSON.stringify(s1MsgHost.body).slice(0, 200)}`)

  // -- both parties can read both messages --
  const s1AsRenterRead = await asUser(s1RenterTok, `messages?select=id&conversation_id=eq.${s1ConvoId}`)
  check('renter can read the thread (both directions present)',
    s1AsRenterRead.status === 200 && s1AsRenterRead.body.length >= 2, `count ${s1AsRenterRead.body?.length}`)
  const s1AsHostRead = await asUser(s1HostTok, `messages?select=id&conversation_id=eq.${s1ConvoId}`)
  check('host can read the thread (both directions present)',
    s1AsHostRead.status === 200 && s1AsHostRead.body.length >= 2, `count ${s1AsHostRead.body?.length}`)

  // -- read receipts flip --
  if (s1MsgHostRow?.id) {
    await asUser(s1RenterTok, `messages?id=eq.${s1MsgHostRow.id}`, { method: 'PATCH', body: JSON.stringify({ is_read: true }) })
    const afterRead = (await admin(`messages?select=is_read&id=eq.${s1MsgHostRow.id}`)).body[0]
    check('renter marking the host\'s message read actually flips is_read (verified via admin re-read)',
      afterRead?.is_read === true, JSON.stringify(afterRead))
  }

  // -- Realtime: does the host actually receive the renter's INSERT live? --
  // A real websocket subscription with a real signed-in session, mirroring
  // useConversation.ts's exact channel/filter shape. This is NOT a proxy for
  // RLS (already proven above by the plain reads) — it is the literal
  // delivery mechanism the app depends on.
  {
    const rtClient = createClient(SUPABASE_URL, ANON)
    await rtClient.auth.signInWithPassword({ email: 'demo@demo.rentivo.ph', password: 'DemoRentivo1' })
    let received = null
    const channel = rtClient
      .channel(`verify:${s1ConvoId}:${stamp}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${s1ConvoId}` },
        (payload) => { received = payload.new })
      .subscribe()

    // Give the channel time to reach SUBSCRIBED before inserting.
    await new Promise((r) => setTimeout(r, 3000))

    const rtProbeMsg = (await admin('messages', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: s1ConvoId, sender_id: renterId, content: `full-inquiries s1 realtime probe ${stamp}` }),
    })).body[0]
    cleanup.messageIds.push(rtProbeMsg.id)

    const deadline = Date.now() + 8000
    while (!received && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))

    check('Realtime: a live channel subscribed to this conversation receives the INSERT event',
      received?.id === rtProbeMsg.id,
      received
        ? `received a different/partial payload: ${JSON.stringify(received)}`
        : 'no postgres_changes event arrived within 8s — see report for root-cause finding (public.messages is not a member of the supabase_realtime publication; pre-existing, not caused by 049-056, also true of notifications/conversations)')

    rtClient.removeChannel(channel)
    await rtClient.auth.signOut().catch(() => {})
  }

  // =========================================================================
  // SCENARIO 2 — a third account can read neither the conversation nor its
  // messages.
  // =========================================================================
  console.log('\n=== SCENARIO 2: non-participant is blocked ===')

  const thirdEmail = `probe-full-third-${stamp}@example.com`
  const thirdId = await createProbeUser(thirdEmail, 'ProbePassword1!')
  cleanup.profileIds.push(thirdId)
  const thirdTok = await signIn(thirdEmail, 'ProbePassword1!')

  const s2Convo = await asUser(thirdTok, `conversations?select=id&id=eq.${s1ConvoId}`)
  check('a third account reads ZERO rows from the conversations table for this conversation',
    s2Convo.status === 200 && Array.isArray(s2Convo.body) && s2Convo.body.length === 0,
    `status ${s2Convo.status} body ${JSON.stringify(s2Convo.body)}`)

  const s2Msgs = await asUser(thirdTok, `messages?select=id&conversation_id=eq.${s1ConvoId}`)
  check('a third account reads ZERO messages from this conversation',
    s2Msgs.status === 200 && Array.isArray(s2Msgs.body) && s2Msgs.body.length === 0,
    `status ${s2Msgs.status} body ${JSON.stringify(s2Msgs.body)}`)

  const s2Insert = await asUser(thirdTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: s1ConvoId, sender_id: thirdId, content: 'should be rejected' }),
  })
  check('a third account cannot insert into this conversation',
    s2Insert.status >= 400, `status ${s2Insert.status} ${JSON.stringify(s2Insert.body)}`)
  if (s2Insert.status < 400 && Array.isArray(s2Insert.body) && s2Insert.body[0]?.id) {
    cleanup.messageIds.push(s2Insert.body[0].id)
  }

  // =========================================================================
  // SCENARIO 3 — create_inquiry refusals + idempotency.
  // =========================================================================
  console.log('\n=== SCENARIO 3: create_inquiry refusals + idempotency ===')

  // -- 3a. Idempotency: a second inquiry on the same listing returns the SAME
  // conversation id, not an error. Dedicated fresh renter+listing.
  const s3aRenterEmail = `probe-full-3a-renter-${stamp}@example.com`
  const s3aRenterId = await createProbeUser(s3aRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3aRenterId)
  const s3aRenterTok = await signIn(s3aRenterEmail, 'ProbePassword1!')
  const s3aListing = await makeListing(hostId)

  const s3aFirst = await rpc(s3aRenterTok, 'create_inquiry', { p_listing_id: s3aListing.id, p_content: 'first inquiry' })
  check('first inquiry on a listing succeeds', s3aFirst.status === 200, `status ${s3aFirst.status} ${s3aFirst.body.slice(0, 150)}`)
  const s3aConvoId = JSON.parse(s3aFirst.body)
  cleanup.conversationIds.push(s3aConvoId)

  const s3aSecond = await rpc(s3aRenterTok, 'create_inquiry', { p_listing_id: s3aListing.id, p_content: 'second inquiry, different text' })
  check('a second inquiry on the same listing returns the SAME conversation id, not an error',
    s3aSecond.status === 200 && JSON.parse(s3aSecond.body) === s3aConvoId,
    `status ${s3aSecond.status} got ${s3aSecond.body.slice(0, 150)} expected ${s3aConvoId}`)

  const s3aMsgs = (await admin(`messages?select=id,content&conversation_id=eq.${s3aConvoId}&order=created_at.asc`)).body
  check('the reused conversation now has both messages (no data lost on reuse)',
    s3aMsgs.length === 2 && s3aMsgs[0].content === 'first inquiry' && s3aMsgs[1].content === 'second inquiry, different text',
    JSON.stringify(s3aMsgs))

  // -- 3b. Refused: own listing.
  const s3bListing = await makeListing(hostId)
  const s3b = await rpc(hostTok, 'create_inquiry', { p_listing_id: s3bListing.id, p_content: 'hi myself' })
  check('cannot inquire on your own listing', s3b.status >= 400, `status ${s3b.status} ${s3b.body.slice(0, 150)}`)

  // -- 3c. Refused: a draft listing. CONTROL: the same host's non-draft
  // listing (created identically) succeeds first, proving the refusal is
  // attributable to is_draft specifically.
  const s3cRenterEmail = `probe-full-3c-renter-${stamp}@example.com`
  const s3cRenterId = await createProbeUser(s3cRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3cRenterId)
  const s3cRenterTok = await signIn(s3cRenterEmail, 'ProbePassword1!')

  const s3cControlListing = await makeListing(hostId)
  const s3cControl = await rpc(s3cRenterTok, 'create_inquiry', { p_listing_id: s3cControlListing.id, p_content: 'control, not draft' })
  check('CONTROL: inquiry succeeds on an otherwise-identical non-draft listing', s3cControl.status === 200, `status ${s3cControl.status} ${s3cControl.body.slice(0, 150)}`)
  if (s3cControl.status === 200) cleanup.conversationIds.push(JSON.parse(s3cControl.body))

  const s3cDraftListing = await makeListing(hostId, { is_draft: true })
  const s3cDraftRow = (await admin(`listings?select=id,is_draft,is_active&id=eq.${s3cDraftListing.id}`)).body[0]
  check('probe draft listing really is a draft (control on the fixture itself)', s3cDraftRow.is_draft === true, JSON.stringify(s3cDraftRow))
  const s3c = await rpc(s3cRenterTok, 'create_inquiry', { p_listing_id: s3cDraftListing.id, p_content: 'hi' })
  check('cannot inquire on a draft listing', s3c.status >= 400, `status ${s3c.status} ${s3c.body.slice(0, 150)}`)

  // -- 3d. Refused: an inactive listing. Same control shape.
  const s3dRenterEmail = `probe-full-3d-renter-${stamp}@example.com`
  const s3dRenterId = await createProbeUser(s3dRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3dRenterId)
  const s3dRenterTok = await signIn(s3dRenterEmail, 'ProbePassword1!')

  const s3dControlListing = await makeListing(hostId)
  const s3dControl = await rpc(s3dRenterTok, 'create_inquiry', { p_listing_id: s3dControlListing.id, p_content: 'control, active' })
  check('CONTROL: inquiry succeeds on an otherwise-identical active listing', s3dControl.status === 200, `status ${s3dControl.status} ${s3dControl.body.slice(0, 150)}`)
  if (s3dControl.status === 200) cleanup.conversationIds.push(JSON.parse(s3dControl.body))

  const s3dInactiveListing = await makeListing(hostId, { is_active: false })
  const s3dInactiveRow = (await admin(`listings?select=id,is_draft,is_active&id=eq.${s3dInactiveListing.id}`)).body[0]
  check('probe inactive listing really is inactive (control on the fixture itself)', s3dInactiveRow.is_active === false && s3dInactiveRow.is_draft === false, JSON.stringify(s3dInactiveRow))
  const s3d = await rpc(s3dRenterTok, 'create_inquiry', { p_listing_id: s3dInactiveListing.id, p_content: 'hi' })
  check('cannot inquire on an inactive listing', s3d.status >= 400, `status ${s3d.status} ${s3d.body.slice(0, 150)}`)

  // -- 3e. Refused: the LISTING'S HOST is suspended. CONTROL proves the
  // refusal is attributable to suspension, not an incidental draft (the
  // exact trap this repo has already hit once — see 056's fix-round-1 note).
  const s3eHostEmail = `probe-full-3e-host-${stamp}@example.com`
  const s3eHostId = await createProbeUser(s3eHostEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3eHostId)
  await admin(`profiles?id=eq.${s3eHostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 3e Host' }),
  })
  const s3eRenterEmail = `probe-full-3e-renter-${stamp}@example.com`
  const s3eRenterId = await createProbeUser(s3eRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3eRenterId)
  const s3eRenterTok = await signIn(s3eRenterEmail, 'ProbePassword1!')

  const s3eListing = await makeListing(s3eHostId)
  const s3eListingRow = (await admin(`listings?select=id,is_draft,is_active&id=eq.${s3eListing.id}`)).body[0]
  check('probe listing for the suspended-host check is really live (control on the fixture)',
    s3eListingRow.is_draft === false && s3eListingRow.is_active === true, JSON.stringify(s3eListingRow))

  const s3eControl = await rpc(s3eRenterTok, 'create_inquiry', { p_listing_id: s3eListing.id, p_content: 'control, host active' })
  check('CONTROL: inquiry succeeds while the listing\'s host is active', s3eControl.status === 200, `status ${s3eControl.status} ${s3eControl.body.slice(0, 150)}`)
  if (s3eControl.status === 200) cleanup.conversationIds.push(JSON.parse(s3eControl.body))

  await admin(`profiles?id=eq.${s3eHostId}`, { method: 'PATCH', body: JSON.stringify({ suspended_at: new Date().toISOString() }) })
  const s3e = await rpc(s3eRenterTok, 'create_inquiry', { p_listing_id: s3eListing.id, p_content: 'hi' })
  check('cannot inquire on a listing whose host is suspended', s3e.status >= 400, `status ${s3e.status} ${s3e.body.slice(0, 150)}`)
  await admin(`profiles?id=eq.${s3eHostId}`, { method: 'PATCH', body: JSON.stringify({ suspended_at: null }) })

  // -- 3f. Refused: the CALLER (renter) is suspended. Same control shape, a
  // distinct fresh renter so the cap check below is never confounded.
  const s3fRenterEmail = `probe-full-3f-renter-${stamp}@example.com`
  const s3fRenterId = await createProbeUser(s3fRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3fRenterId)
  const s3fRenterTok = await signIn(s3fRenterEmail, 'ProbePassword1!')
  const s3fListing = await makeListing(hostId)

  const s3fControl = await rpc(s3fRenterTok, 'create_inquiry', { p_listing_id: s3fListing.id, p_content: 'control, renter active' })
  check('CONTROL: a not-yet-suspended renter can open an inquiry', s3fControl.status === 200, `status ${s3fControl.status} ${s3fControl.body.slice(0, 150)}`)
  if (s3fControl.status === 200) cleanup.conversationIds.push(JSON.parse(s3fControl.body))

  await admin(`profiles?id=eq.${s3fRenterId}`, { method: 'PATCH', body: JSON.stringify({ suspended_at: new Date().toISOString() }) })
  const s3f = await rpc(s3fRenterTok, 'create_inquiry', { p_listing_id: s3fListing.id, p_content: 'hi, should be refused' })
  check('a suspended renter cannot open a new inquiry', s3f.status >= 400, `status ${s3f.status} ${s3f.body.slice(0, 150)}`)
  await admin(`profiles?id=eq.${s3fRenterId}`, { method: 'PATCH', body: JSON.stringify({ suspended_at: null }) })

  // -- 3g. Refused: empty content.
  const s3gListing = await makeListing(hostId)
  const s3g = await rpc(s3fRenterTok, 'create_inquiry', { p_listing_id: s3gListing.id, p_content: '   ' })
  check('cannot inquire with empty/whitespace content', s3g.status >= 400, `status ${s3g.status} ${s3g.body.slice(0, 150)}`)

  // -- 3h. Refused: unknown listing id.
  const s3h = await rpc(s3fRenterTok, 'create_inquiry', { p_listing_id: '00000000-0000-0000-0000-000000000000', p_content: 'hi' })
  check('cannot inquire on an unknown listing id', s3h.status >= 400, `status ${s3h.status} ${s3h.body.slice(0, 150)}`)

  // -- 3i. Refused: the 11th conversation in 24h for one renter (cap of 10).
  // CONTROL is implicit — the first 10 succeeding IS the control that the
  // renter/host/listings are otherwise all valid.
  const s3iRenterEmail = `probe-full-3i-renter-${stamp}@example.com`
  const s3iRenterId = await createProbeUser(s3iRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s3iRenterId)
  const s3iRenterTok = await signIn(s3iRenterEmail, 'ProbePassword1!')

  const s3iListingIds = []
  for (let i = 0; i < 11; i++) {
    const l = await makeListing(hostId)
    s3iListingIds.push(l.id)
  }
  const s3iConvoIds = []
  for (let i = 0; i < 10; i++) {
    const r = await rpc(s3iRenterTok, 'create_inquiry', { p_listing_id: s3iListingIds[i], p_content: `probe ${i}` })
    if (r.status === 200) s3iConvoIds.push(JSON.parse(r.body))
  }
  cleanup.conversationIds.push(...s3iConvoIds)
  check('10 conversations for one renter within 24h all succeed', s3iConvoIds.length === 10, `created ${s3iConvoIds.length}`)

  const s3i = await rpc(s3iRenterTok, 'create_inquiry', { p_listing_id: s3iListingIds[10], p_content: 'probe 11' })
  check('the 11th conversation in 24h is refused (cap of 10)', s3i.status >= 400, `status ${s3i.status} ${s3i.body.slice(0, 150)}`)

  // -- 3j. Grant boundary: anon key (no session at all) cannot call it.
  const s3j = await rpc(ANON, 'create_inquiry', { p_listing_id: s3aListing.id, p_content: 'hi' })
  check('the bare anon key cannot call create_inquiry at all', s3j.status >= 400, `status ${s3j.status} ${s3j.body.slice(0, 160)}`)

  // =========================================================================
  // SCENARIO 4 — opening an inquiry then booking that listing attaches it:
  // same conversation id, earlier messages still present.
  // =========================================================================
  console.log('\n=== SCENARIO 4: inquiry attaches to a booking ===')

  const s4RenterEmail = `probe-full-4-renter-${stamp}@example.com`
  const s4RenterId = await createProbeUser(s4RenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s4RenterId)
  const s4RenterTok = await signIn(s4RenterEmail, 'ProbePassword1!')
  const s4Listing = await makeListing(hostId)

  const s4Inquiry = await rpc(s4RenterTok, 'create_inquiry', { p_listing_id: s4Listing.id, p_content: 'is this available for next month?' })
  check('scenario 4: opening the inquiry succeeds', s4Inquiry.status === 200, `status ${s4Inquiry.status} ${s4Inquiry.body.slice(0, 150)}`)
  const s4ConvoId = JSON.parse(s4Inquiry.body)
  cleanup.conversationIds.push(s4ConvoId)

  const s4ConvoBeforeBooking = (await admin(`conversations?select=id,booking_id&id=eq.${s4ConvoId}`)).body[0]
  check('scenario 4: conversation has booking_id NULL before booking (real inquiry, not pre-attached)',
    s4ConvoBeforeBooking?.booking_id === null, JSON.stringify(s4ConvoBeforeBooking))

  const s4Book = await bookListing(s4RenterTok, s4Listing.id, 30)
  check('scenario 4: create_booking succeeds for the same listing+renter', s4Book.status === 200 || s4Book.status === 201, s4Book.body.slice(0, 200))
  const s4BookRow = JSON.parse(s4Book.body)
  cleanup.bookingIds.push(s4BookRow.id)

  // Deep-link resolution check (mirrors the real `?booking=` path in
  // dashboard/messages/page.tsx): resolve conversations by booking_id via a
  // real anon-key session BEFORE sending any further message — the exact
  // ordering this run is required not to violate, since a prior task's run
  // let a subsequent send manufacture the pass.
  const s4DeepLink = await asUser(s4RenterTok, `conversations?select=id,booking_id&booking_id=eq.${s4BookRow.id}`)
  check('deep-link resolution (?booking=<id>): resolves to the SAME conversation, before any post-attach message is sent',
    s4DeepLink.status === 200 && s4DeepLink.body[0]?.id === s4ConvoId,
    `status ${s4DeepLink.status} body ${JSON.stringify(s4DeepLink.body)} expected ${s4ConvoId}`)

  const s4ConvoAfterBooking = (await admin(`conversations?select=id,booking_id&id=eq.${s4ConvoId}`)).body[0]
  check('the SAME conversation now has booking_id set to the new booking (attach-by-trigger)',
    s4ConvoAfterBooking?.booking_id === s4BookRow.id, JSON.stringify(s4ConvoAfterBooking))

  const s4EarlierMsg = (await admin(`messages?select=id&conversation_id=eq.${s4ConvoId}&content=eq.is this available for next month?`)).body
  check('the original inquiry message is still present after attach', s4EarlierMsg.length === 1, JSON.stringify(s4EarlierMsg))

  // =========================================================================
  // SCENARIO 5 — booking the SAME listing a second time creates a SECOND
  // conversation and does not violate conversations_open_inquiry_key.
  // =========================================================================
  console.log('\n=== SCENARIO 5: repeat booking creates a second conversation ===')

  // The partial unique index (listing_id, renter_id) WHERE booking_id IS
  // NULL guarantees at most one open inquiry per pair — scenario 4 just
  // consumed the only one for (s4Listing, s4Renter), so this second
  // create_booking's attach trigger UPDATE matches zero rows and MUST fall
  // through to the trigger's INSERT branch to succeed at all. That branch's
  // coverage is real, not incidental — asserted explicitly below.
  const s5Book = await bookListing(s4RenterTok, s4Listing.id, 60)
  check('scenario 5: a second booking of the same listing+renter succeeds', s5Book.status === 200 || s5Book.status === 201, s5Book.body.slice(0, 200))
  const s5BookRow = JSON.parse(s5Book.body)
  cleanup.bookingIds.push(s5BookRow.id)

  const s5Convos = (await admin(`conversations?select=id,booking_id,listing_id,renter_id,host_id&booking_id=eq.${s5BookRow.id}`)).body
  check('the second booking has exactly one conversation, and it is NOT scenario 4\'s conversation',
    s5Convos.length === 1 && s5Convos[0].id !== s4ConvoId, JSON.stringify(s5Convos))
  const s5Convo = s5Convos[0]
  if (s5Convo) cleanup.conversationIds.push(s5Convo.id)
  check('the fallback conversation\'s identity fields match the booking exactly (no renter/host swap)',
    !!s5Convo && s5Convo.listing_id === s5BookRow.listing_id && s5Convo.renter_id === s5BookRow.renter_id && s5Convo.host_id === s5BookRow.host_id,
    `${JSON.stringify(s5Convo)} vs booking listing=${s5BookRow.listing_id} renter=${s5BookRow.renter_id} host=${s5BookRow.host_id}`)

  // The partial unique index itself was never violated (both create_booking
  // calls returned success, not a 23505) — confirm no leftover open inquiry
  // for this pair remains that a THIRD booking could collide with.
  const s5OpenInquiries = (await admin(`conversations?select=id&listing_id=eq.${s4Listing.id}&renter_id=eq.${s4RenterId}&booking_id=is.null`)).body
  check('no dangling open inquiry remains for this (listing, renter) pair after two bookings', s5OpenInquiries.length === 0, JSON.stringify(s5OpenInquiries))

  // =========================================================================
  // SCENARIO 6 — notifyNewMessage() recipient resolution + notify_messages.
  // =========================================================================
  console.log('\n=== SCENARIO 6: notifyNewMessage recipient resolution ===')

  const s6RenterEmail = `probe-full-6-renter-${stamp}@example.com`
  const s6HostEmail = `probe-full-6-host-${stamp}@example.com`
  const s6RenterId = await createProbeUser(s6RenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s6RenterId)
  const s6HostId = await createProbeUser(s6HostEmail, 'ProbePassword1!')
  cleanup.profileIds.push(s6HostId)
  await admin(`profiles?id=eq.${s6HostId}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 6 Host', notify_messages: true }) })
  await admin(`profiles?id=eq.${s6RenterId}`, { method: 'PATCH', body: JSON.stringify({ full_name: 'Probe 6 Renter', notify_messages: true }) })
  const s6RenterSession = await signInFull(s6RenterEmail, 'ProbePassword1!')
  const s6HostSession = await signInFull(s6HostEmail, 'ProbePassword1!')

  // -- Case A: booking-thread message, renter -> host --
  const s6ListingA = await makeListing(s6HostId)
  const s6BookA = await bookListing(s6RenterSession.access_token, s6ListingA.id, 45)
  check('scenario 6 case A: booking created', s6BookA.status === 200 || s6BookA.status === 201, s6BookA.body.slice(0, 200))
  const s6BookARow = JSON.parse(s6BookA.body)
  cleanup.bookingIds.push(s6BookARow.id)
  const s6ConvoARow = (await admin(`conversations?select=id,booking_id&booking_id=eq.${s6BookARow.id}`)).body[0]
  check('case A conversation exists with booking_id set (a booking thread, not an inquiry)', s6ConvoARow?.booking_id === s6BookARow.id, JSON.stringify(s6ConvoARow))
  cleanup.conversationIds.push(s6ConvoARow.id)

  const s6MsgA = (await admin('messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: s6ConvoARow.id, sender_id: s6RenterId, content: 'case A: renter -> host' }),
  })).body[0]
  cleanup.messageIds.push(s6MsgA.id)

  await admin(`profiles?id=eq.${s6HostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  let offset = currentLogSize()
  const s6NotifyA = await callNotify(s6RenterSession, s6MsgA.id)
  check('POST /api/messages/notify accepts case A (renter is the sender)', s6NotifyA.status === 200, `status ${s6NotifyA.status} ${s6NotifyA.body.slice(0, 200)}`)
  const s6RecipientA = await waitForSkipLine(offset)
  check('case A: booking-thread message resolves recipient to the HOST, and notify_messages=false is respected (skipped)',
    s6RecipientA === s6HostId, `resolved ${s6RecipientA}, expected host ${s6HostId}`)
  await admin(`profiles?id=eq.${s6HostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: true }) })

  // -- Case A': same conversation, host -> renter (proves "whichever party is
  // NOT the sender", not "always the host") --
  const s6MsgARev = (await admin('messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: s6ConvoARow.id, sender_id: s6HostId, content: 'case A reverse: host -> renter' }),
  })).body[0]
  cleanup.messageIds.push(s6MsgARev.id)

  await admin(`profiles?id=eq.${s6RenterId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  offset = currentLogSize()
  const s6NotifyARev = await callNotify(s6HostSession, s6MsgARev.id)
  check('POST /api/messages/notify accepts case A-reverse (host is the sender)', s6NotifyARev.status === 200, `status ${s6NotifyARev.status} ${s6NotifyARev.body.slice(0, 200)}`)
  const s6RecipientARev = await waitForSkipLine(offset)
  check('case A-reverse: resolves recipient to the RENTER (counterparty), notify_messages=false respected',
    s6RecipientARev === s6RenterId, `resolved ${s6RecipientARev}, expected renter ${s6RenterId}`)

  // -- Case A on: with notify_messages restored true, the same skip branch
  // must NOT fire — proves the flag gates both directions, not just off. --
  await admin(`profiles?id=eq.${s6RenterId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: true }) })
  const s6RenterProfile = (await admin(`profiles?select=notify_messages&id=eq.${s6RenterId}`)).body[0]
  check('CONTROL: notify_messages is really back to true before the "does not skip" assertion', s6RenterProfile?.notify_messages === true, JSON.stringify(s6RenterProfile))
  const s6MsgAOn = (await admin('messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: s6ConvoARow.id, sender_id: s6HostId, content: 'case A on: host -> renter, notify on' }),
  })).body[0]
  cleanup.messageIds.push(s6MsgAOn.id)
  offset = currentLogSize()
  const s6NotifyAOn = await callNotify(s6HostSession, s6MsgAOn.id)
  check('POST /api/messages/notify accepts case A-on', s6NotifyAOn.status === 200, `status ${s6NotifyAOn.status} ${s6NotifyAOn.body.slice(0, 200)}`)
  await new Promise((r) => setTimeout(r, 2000))
  const s6LogAOn = readLogSince(offset)
  check('case A-on: with notify_messages=true, the skip branch for this recipient does NOT fire (flag respected both ways)',
    !new RegExp(`skipped new-message email — notify_messages off for recipient ${s6RenterId}`).test(s6LogAOn),
    s6LogAOn.slice(0, 400))

  // -- Case B: inquiry-thread message (booking_id null), renter -> host --
  const s6ListingB = await makeListing(s6HostId)
  const s6InquiryB = await rpc(s6RenterSession.access_token, 'create_inquiry', { p_listing_id: s6ListingB.id, p_content: 'case B: inquiry probe message' })
  check('scenario 6 case B: create_inquiry succeeds', s6InquiryB.status === 200, `status ${s6InquiryB.status} ${s6InquiryB.body.slice(0, 200)}`)
  const s6ConvoBId = JSON.parse(s6InquiryB.body)
  cleanup.conversationIds.push(s6ConvoBId)

  const s6ConvoBRow = (await admin(`conversations?select=id,booking_id&id=eq.${s6ConvoBId}`)).body[0]
  check('case B conversation has booking_id NULL (a real inquiry thread)', s6ConvoBRow?.booking_id === null, JSON.stringify(s6ConvoBRow))

  const s6MsgB = (await admin(`messages?select=id,sender_id&conversation_id=eq.${s6ConvoBId}`)).body[0]
  check('case B message exists (inserted by create_inquiry itself)', s6MsgB?.sender_id === s6RenterId, JSON.stringify(s6MsgB))

  await admin(`profiles?id=eq.${s6HostId}`, { method: 'PATCH', body: JSON.stringify({ notify_messages: false }) })
  offset = currentLogSize()
  const s6NotifyB = await callNotify(s6RenterSession, s6MsgB.id)
  check('POST /api/messages/notify accepts case B (inquiry thread)', s6NotifyB.status === 200, `status ${s6NotifyB.status} ${s6NotifyB.body.slice(0, 200)}`)
  const s6RecipientB = await waitForSkipLine(offset)
  check('case B: inquiry-thread message (booking_id NULL) resolves recipient to the HOST', s6RecipientB === s6HostId, `resolved ${s6RecipientB}, expected host ${s6HostId}`)

  // =========================================================================
  // GRANT AUDIT — migration 017's standing audit, re-run against
  // conversations/messages. Folded into the script itself (rather than left
  // as an ad hoc terminal command only prose attests to) so a rerun of this
  // file IS the evidence. Uses the Supabase CLI (`supabase db query
  // --linked`) because pg_class/information_schema queries have no PostgREST
  // equivalent — this is not an RLS-scoped assertion like everything above,
  // it is a direct system-catalog check of what the schema actually grants.
  // =========================================================================
  console.log('\n=== GRANT AUDIT: conversations + messages ===')

  const rlsRows = dbQuery(
    `select relname, relrowsecurity from pg_class where relname in ('conversations','messages') order by relname;`
  )
  check('RLS enabled on conversations', rlsRows.find((r) => r.relname === 'conversations')?.relrowsecurity === true, JSON.stringify(rlsRows))
  check('RLS enabled on messages', rlsRows.find((r) => r.relname === 'messages')?.relrowsecurity === true, JSON.stringify(rlsRows))

  const tableGrants = dbQuery(
    `select grantee, table_name, privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name in ('conversations','messages') and grantee in ('anon','authenticated')
     order by table_name, grantee, privilege_type;`
  )
  const convoGrants = tableGrants.filter((r) => r.table_name === 'conversations')
  check('conversations: anon has NO table-level grant at all', convoGrants.filter((r) => r.grantee === 'anon').length === 0, JSON.stringify(convoGrants))
  check('conversations: authenticated has exactly SELECT (no INSERT/UPDATE/DELETE)',
    convoGrants.filter((r) => r.grantee === 'authenticated').length === 1 &&
    convoGrants.some((r) => r.grantee === 'authenticated' && r.privilege_type === 'SELECT'),
    JSON.stringify(convoGrants))

  const messagesTableGrants = tableGrants.filter((r) => r.table_name === 'messages')
  check('messages: no table-level UPDATE grant for anon or authenticated (013\'s column grant would otherwise be decorative — see migration 053)',
    !messagesTableGrants.some((r) => r.privilege_type === 'UPDATE'), JSON.stringify(messagesTableGrants))

  const messagesUpdateColumnGrants = dbQuery(
    `select grantee, column_name from information_schema.role_column_grants
     where table_schema='public' and table_name='messages' and privilege_type='UPDATE' and grantee='authenticated'
     order by column_name;`
  )
  check('messages: authenticated\'s only column-level UPDATE grant is is_read',
    messagesUpdateColumnGrants.length === 1 && messagesUpdateColumnGrants[0].column_name === 'is_read',
    JSON.stringify(messagesUpdateColumnGrants))

  const createInquiryGrants = dbQuery(`select grantee from information_schema.role_routine_grants where routine_name='create_inquiry';`)
  const createInquiryGrantees = createInquiryGrants.map((r) => r.grantee).sort()
  check('create_inquiry: authenticated + service_role hold EXECUTE', createInquiryGrantees.includes('authenticated') && createInquiryGrantees.includes('service_role'), JSON.stringify(createInquiryGrantees))
  check('create_inquiry: anon and public do NOT hold EXECUTE', !createInquiryGrantees.includes('anon') && !createInquiryGrantees.includes('public'), JSON.stringify(createInquiryGrantees))

  console.log('\n=== all scenarios executed ===')
}

try {
  await main()
} catch (e) {
  console.error(e)
  check('script completed without throwing', false, String(e?.stack || e))
} finally {
  if (serverProc) {
    serverProc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
  }

  // ── Cleanup, in dependency order ─────────────────────────────────────────
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
  // Restores queued by name (e.g. a real, pre-existing conversation's
  // last_message_at that Scenario 1's probe messages bumped) — see the push
  // right after Scenario 1 determines whether s1ConvoId is real or throwaway.
  for (const r of cleanup.restores) {
    await admin(`${r.table}?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ [r.field]: r.value }) })
  }

  const baselineAfter = {
    conversations: (await admin('conversations?select=id&limit=2000')).body.length,
    messages: (await admin('messages?select=id&limit=2000')).body.length,
    bookings: (await admin('bookings?select=id&limit=2000')).body.length,
    listings: (await admin('listings?select=id&limit=2000')).body.length,
    profiles: (await admin('profiles?select=id&limit=2000')).body.length,
  }
  console.log('baseline after:', JSON.stringify(baselineAfter))
  // All five captured baseline values are compared, not just three — an
  // uncompared captured value looks like coverage that isn't actually there.
  check('baseline restored: conversations=17', baselineAfter.conversations === 17, JSON.stringify(baselineAfter))
  check('baseline restored: messages=2', baselineAfter.messages === 2, JSON.stringify(baselineAfter))
  check('baseline restored: bookings=17', baselineAfter.bookings === 17, JSON.stringify(baselineAfter))
  check('baseline restored: listings=25', baselineAfter.listings === 25, JSON.stringify(baselineAfter))
  check('baseline restored: profiles=24', baselineAfter.profiles === 24, JSON.stringify(baselineAfter))

  const forbiddenHostRow = (await admin(`profiles?select=id,suspended_at&id=eq.${FORBIDDEN_HOST_ID}`)).body[0]
  check('forbidden host untouched (not suspended)', forbiddenHostRow && forbiddenHostRow.suspended_at === null, JSON.stringify(forbiddenHostRow))
  const forbiddenBookingRow = (await admin(`bookings?select=booking_ref,status&booking_ref=eq.${FORBIDDEN_BOOKING_CODE}`)).body[0]
  check('forbidden booking still exists untouched', !!forbiddenBookingRow, JSON.stringify(forbiddenBookingRow))
}

done()
