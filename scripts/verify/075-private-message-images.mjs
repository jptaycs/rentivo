// Verifies migration 075: the message-images bucket is private and objects
// are readable only by their uploader or by a party to a conversation holding
// a message that attaches them.
//
// Every authorisation claim is made with a REAL signed-in session (or no
// session at all, for anon) against the Storage API — the service role
// bypasses storage RLS and proves nothing, so it is used only for setup,
// independent re-reads and cleanup.
//
// Denials are checked against the right oracle. Storage answers an
// unreadable object with 400 + {error:"not_found"} (it deliberately does not
// distinguish "no such object" from "not allowed"), so every denial is paired
// with a CONTROL sending the byte-identical request with an entitled token and
// getting a real signed URL back. That is what proves the refusal is the
// policy and not a malformed request.
//
// Throwaway data only: one conversation demo renter <-> demo host, one
// stranger conversation throwaway user <-> demo host, one throwaway
// non-party user. The forbidden host/booking are read-only checked.
//
// Usage: node scripts/verify/075-private-message-images.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const BUCKET = 'message-images'
const ST = `${SUPABASE_URL}/storage/v1`

// A real 2x2 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64'
)

const sub = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub

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

const authHeaders = (token) => ({ apikey: ANON, Authorization: `Bearer ${token ?? ANON}` })

async function upload(token, path) {
  const res = await fetch(`${ST}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'image/png' },
    body: PNG,
  })
  return { status: res.status, body: await res.text() }
}

/** Single-object sign, exactly what createSignedUrl() sends. */
async function sign(token, path) {
  const res = await fetch(`${ST}/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, url: body?.signedURL ? `${ST}${body.signedURL}` : null }
}

/** Batched sign, exactly what createSignedUrls() (the app's call) sends. */
async function signMany(token, paths) {
  const res = await fetch(`${ST}/object/sign/${BUCKET}`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60, paths }),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

const isNotFoundDenial = (r) =>
  r.status === 400 && !r.url && /not.?found/i.test(JSON.stringify(r.body))

async function fetchBytes(url, headers = {}) {
  const res = await fetch(url, { headers })
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, buf }
}

const adminStorage = (path, init = {}) =>
  fetch(`${ST}/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })

const baseline = async () => ({
  conversations: (await admin('conversations?select=id')).body.length,
  messages: (await admin('messages?select=id')).body.length,
  imageMessages: (await admin('messages?select=id&image_url=not.is.null')).body.length,
})
const objectCount = async () => {
  const res = await adminStorage(`object/list/${BUCKET}`, {
    method: 'POST',
    body: JSON.stringify({ prefix: '', limit: 1000 }),
  })
  return (await res.json()).length
}

const before = await baseline()
const beforeObjects = await objectCount()
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const hostTok = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
const renterId = sub(renterTok)
const hostId = sub(hostTok)

const stamp = Date.now()
const outsiderId = await createUser(`probe-075-outsider-${stamp}@example.com`) // stranger's conversation renter
const nonPartyId = await createUser(`probe-075-nonparty-${stamp}@example.com`) // in no conversation at all
// Since migration 076, every non-service-role message insert records a
// rate-limit hit keyed `message:<sender id>`. This script predates 076, so
// without this its runs left hit rows behind — including for throwaway users
// it had already deleted. Scoped to this run's start and these four senders.
const runStartedAt = new Date().toISOString()
const outsiderTok = await signIn(`probe-075-outsider-${stamp}@example.com`, 'ProbeRentivo1')
const nonPartyTok = await signIn(`probe-075-nonparty-${stamp}@example.com`, 'ProbeRentivo1')

const createdConversations = []
const createdPaths = []

try {
  // ── setup: a demo host listing the demo renter has no open inquiry on ────
  const { body: listings } = await admin(`listings?select=id&host_id=eq.${hostId}&order=created_at.asc`)
  const { body: openInquiries } = await admin(
    `conversations?select=listing_id&renter_id=eq.${renterId}&booking_id=is.null`
  )
  const taken = new Set(openInquiries.map((c) => c.listing_id))
  const listing = listings.find((l) => !taken.has(l.id))
  if (!listing) throw new Error('no demo host listing without an open demo-renter inquiry')

  const { status: cS, body: [convo] } = await admin('conversations', {
    method: 'POST',
    body: JSON.stringify({ listing_id: listing.id, renter_id: renterId, host_id: hostId }),
  })
  if (cS !== 201) throw new Error('conversation insert ' + cS)
  createdConversations.push(convo.id)
  const { body: [strangerConvo] } = await admin('conversations', {
    method: 'POST',
    body: JSON.stringify({ listing_id: listing.id, renter_id: outsiderId, host_id: hostId }),
  })
  createdConversations.push(strangerConvo.id)

  // ── 1. bucket is private ─────────────────────────────────────────────────
  const bucket = await (await adminStorage(`bucket/${BUCKET}`)).json()
  check('bucket reports public = false', bucket.public === false, `public=${bucket.public}`)

  // ── upload as the sender (demo renter) ───────────────────────────────────
  const path = `${renterId}/${crypto.randomUUID()}.png`
  const up = await upload(renterTok, path)
  check('sender can upload to own folder', up.status === 200, `status ${up.status} ${up.body}`)
  createdPaths.push(path)

  // ── 2. upload-then-insert window ─────────────────────────────────────────
  const senderEarly = await sign(renterTok, path)
  check('sender can sign own upload BEFORE any message references it', senderEarly.status === 200 && !!senderEarly.url, `status ${senderEarly.status}`)
  const recipientEarly = await sign(hostTok, path)
  check(
    'recipient canNOT sign it before the message exists (the message is what grants access)',
    isNotFoundDenial(recipientEarly),
    `status ${recipientEarly.status} ${JSON.stringify(recipientEarly.body)}`
  )

  // ── attach it: the app's exact insert shape, as the sender ───────────────
  const ins = await asUser(renterTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: convo.id, sender_id: renterId, content: 'probe 075', image_url: path }),
  })
  check('message carrying the storage path inserts (201)', ins.status === 201, `status ${ins.status} ${JSON.stringify(ins.body)}`)

  // CHECK constraint: a message may only reference its own sender's folder.
  const hostPath = `${hostId}/${crypto.randomUUID()}.png`
  const forged = await asUser(renterTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: convo.id, sender_id: renterId, content: 'probe 075 forged', image_url: hostPath }),
  })
  check(
    'message referencing ANOTHER user\'s folder is refused by messages_image_path_shape',
    forged.status === 400 && /messages_image_path_shape/.test(JSON.stringify(forged.body)),
    `status ${forged.status} ${JSON.stringify(forged.body)}`
  )
  const urlValue = await asUser(renterTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: convo.id, sender_id: renterId, content: 'probe 075 url', image_url: `https://evil.example.com/${renterId}.png` }),
  })
  check(
    'message carrying an arbitrary URL is refused by messages_image_path_shape',
    urlValue.status === 400 && /messages_image_path_shape/.test(JSON.stringify(urlValue.body)),
    `status ${urlValue.status}`
  )

  // ── 3. old public URL is dead ────────────────────────────────────────────
  const pub = await fetchBytes(`${ST}/object/public/${BUCKET}/${path}`)
  check('old /object/public/ URL no longer serves the file', pub.status >= 400 && !pub.buf.equals(PNG), `status ${pub.status}`)

  // ── 4. anon ──────────────────────────────────────────────────────────────
  const anonSign = await sign(null, path)
  check('anon canNOT create a signed URL', isNotFoundDenial(anonSign) || anonSign.status === 403 || anonSign.status === 401, `status ${anonSign.status} ${JSON.stringify(anonSign.body)}`)
  const anonDl = await fetchBytes(`${ST}/object/authenticated/${BUCKET}/${path}`, authHeaders(null))
  check('anon canNOT download via the authenticated object API', anonDl.status >= 400 && !anonDl.buf.equals(PNG), `status ${anonDl.status}`)
  const anonDlNoKey = await fetchBytes(`${ST}/object/${BUCKET}/${path}`)
  check('bare unauthenticated object fetch is refused', anonDlNoKey.status >= 400 && !anonDlNoKey.buf.equals(PNG), `status ${anonDlNoKey.status}`)

  // ── 5. signed-in stranger (party to nothing) ─────────────────────────────
  const strangerSign = await sign(nonPartyTok, path)
  check('signed-in stranger canNOT create a signed URL', isNotFoundDenial(strangerSign), `status ${strangerSign.status} ${JSON.stringify(strangerSign.body)}`)
  const strangerDl = await fetchBytes(`${ST}/object/authenticated/${BUCKET}/${path}`, authHeaders(nonPartyTok))
  check('signed-in stranger canNOT download it directly', strangerDl.status >= 400 && !strangerDl.buf.equals(PNG), `status ${strangerDl.status}`)

  // ── 6. sender (CONTROL for every denial above — same request shape) ──────
  const senderSign = await sign(renterTok, path)
  check('CONTROL sender can create a signed URL', senderSign.status === 200 && !!senderSign.url, `status ${senderSign.status}`)
  const senderBytes = await fetchBytes(senderSign.url)
  check('sender\'s signed URL returns the exact image bytes', senderBytes.status === 200 && senderBytes.buf.equals(PNG), `status ${senderBytes.status}, ${senderBytes.buf.length}B`)

  // ── 7. recipient ─────────────────────────────────────────────────────────
  const recipSign = await sign(hostTok, path)
  check('recipient (other party) can create a signed URL', recipSign.status === 200 && !!recipSign.url, `status ${recipSign.status}`)
  const recipBytes = await fetchBytes(recipSign.url)
  check('recipient\'s signed URL returns the exact image bytes', recipBytes.status === 200 && recipBytes.buf.equals(PNG), `status ${recipBytes.status}`)
  const recipBatch = await signMany(hostTok, [path])
  check(
    'recipient batched createSignedUrls (the app\'s call) returns a signed URL',
    recipBatch.status === 200 && Array.isArray(recipBatch.body) && !!recipBatch.body[0]?.signedURL && !recipBatch.body[0]?.error,
    JSON.stringify(recipBatch.body)
  )

  // ── 8. a party canNOT sign an object in someone else's folder attached to
  //       a conversation they are NOT in ────────────────────────────────────
  const outsiderPath = `${outsiderId}/${crypto.randomUUID()}.png`
  const up2 = await upload(outsiderTok, outsiderPath)
  check('outsider uploads to own folder', up2.status === 200, `status ${up2.status} ${up2.body}`)
  createdPaths.push(outsiderPath)
  const ins2 = await asUser(outsiderTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: strangerConvo.id, sender_id: outsiderId, content: 'probe 075 other', image_url: outsiderPath }),
  })
  check('outsider attaches it in their conversation with the demo host', ins2.status === 201, `status ${ins2.status} ${JSON.stringify(ins2.body)}`)

  const renterOther = await sign(renterTok, outsiderPath)
  check(
    'demo renter (a party elsewhere) canNOT sign an object attached only to a conversation they are not in',
    isNotFoundDenial(renterOther),
    `status ${renterOther.status} ${JSON.stringify(renterOther.body)}`
  )
  const renterOtherBatch = await signMany(renterTok, [outsiderPath, path])
  check(
    'batched sign mixing a foreign object: foreign entry errors, own entry still signs',
    renterOtherBatch.status === 200 &&
      !renterOtherBatch.body.find((i) => i.path === outsiderPath)?.signedURL &&
      !!renterOtherBatch.body.find((i) => i.path === path)?.signedURL,
    JSON.stringify(renterOtherBatch.body)
  )
  const hostOther = await sign(hostTok, outsiderPath)
  check('CONTROL demo host (party to that conversation) CAN sign it', hostOther.status === 200 && !!hostOther.url, `status ${hostOther.status}`)

  // ── helper function grants ───────────────────────────────────────────────
  const anonRpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_read_message_image`, {
    method: 'POST',
    headers: { ...authHeaders(null), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: path }),
  })
  check('anon cannot execute can_read_message_image', anonRpc.status === 401 || anonRpc.status === 403 || anonRpc.status === 404, `status ${anonRpc.status}`)
  const authRpc = await asUser(nonPartyTok, 'rpc/can_read_message_image', { method: 'POST', body: JSON.stringify({ p_name: path }) })
  check('non-party gets a plain false from can_read_message_image', authRpc.status === 200 && authRpc.body === false, `status ${authRpc.status} ${JSON.stringify(authRpc.body)}`)
  const hostRpc = await asUser(hostTok, 'rpc/can_read_message_image', { method: 'POST', body: JSON.stringify({ p_name: path }) })
  check('CONTROL party gets true from can_read_message_image', hostRpc.status === 200 && hostRpc.body === true, `status ${hostRpc.status} ${JSON.stringify(hostRpc.body)}`)

  // ── forbidden resources untouched ────────────────────────────────────────
  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('forbidden host untouched', fHostAfter?.updated_at === fHostBefore?.updated_at)
  check('forbidden booking untouched', fBookingAfter?.updated_at === fBookingBefore?.updated_at)
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  if (createdPaths.length) {
    await adminStorage(`object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: createdPaths }) })
  }
  for (const id of createdConversations) await admin(`conversations?id=eq.${id}`, { method: 'DELETE' }) // cascades messages
  const hitKeys = [renterId, hostId, outsiderId, nonPartyId].map((id) => `"message:${id}"`).join(',')
  await admin(`rate_limit_hits?key=in.(${hitKeys})&hit_at=gte.${encodeURIComponent(runStartedAt)}`, { method: 'DELETE' })
  await deleteUser(outsiderId)
  await deleteUser(nonPartyId)
}

const after = await baseline()
check('cleanup: conversations back to baseline', after.conversations === before.conversations, `${before.conversations} -> ${after.conversations}`)
check('cleanup: messages back to baseline', after.messages === before.messages, `${before.messages} -> ${after.messages}`)
check('cleanup: image messages back to baseline', after.imageMessages === before.imageMessages, `${before.imageMessages} -> ${after.imageMessages}`)
check('cleanup: bucket object count back to baseline', (await objectCount()) === beforeObjects, `${beforeObjects}`)
for (const p of createdPaths) {
  const r = await adminStorage(`object/${BUCKET}/${p}`)
  check(`cleanup: object ${p.slice(0, 8)}… deleted (service-role re-read 4xx)`, r.status >= 400, `status ${r.status}`)
}
const { body: leftoverProfiles } = await admin(`profiles?select=id&id=in.(${outsiderId},${nonPartyId})`)
check('cleanup: throwaway users removed', leftoverProfiles.length === 0, `${leftoverProfiles.length} left`)
const leftoverHitKeys = [renterId, hostId, outsiderId, nonPartyId].map((id) => `"message:${id}"`).join(',')
const { body: leftoverHits } = await admin(
  `rate_limit_hits?select=key&key=in.(${leftoverHitKeys})&hit_at=gte.${encodeURIComponent(runStartedAt)}`
)
check('cleanup: this run left no rate-limit hits (076)', Array.isArray(leftoverHits) && leftoverHits.length === 0,
  `${Array.isArray(leftoverHits) ? leftoverHits.length : JSON.stringify(leftoverHits)} left`)
done()
