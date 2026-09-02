// Verification for migration 053 (messages RLS moved from bookings onto
// conversations) plus its fix-round-1 hardening in migration 054 (booking_id
// forgery closed, UPDATE policy gets an explicit WITH CHECK). Exercises every
// currently-deployed client path (old-shape insert with no conversation_id,
// participant read, read-receipt update) plus the checks the policy swap and
// its hardening exist for (non-participant blocked, content/sender_id
// tampering blocked, booking_id forgery overwritten, a bookingless
// conversation actually readable by its participants and nobody else). All
// access assertions go through asUser() with a real signed-in session —
// admin() is used only for setup, independent assertion of stored state, and
// cleanup.
import { admin, asUser, signIn, check, done, URL, SECRET } from './env.mjs'

const FORBIDDEN_HOST_ID = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68' // Isse Capucao — do not touch
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

const hostTok   = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')

// Find a booking the demo renter/host are party to, and its conversation.
// Deliberately excludes the forbidden host — 048/task briefs across this repo
// name that host and booking as off-limits for probe writes.
const bookings = (await admin('bookings?select=id,renter_id,host_id,listing_id,booking_ref&limit=200')).body
const usable = bookings.filter(b =>
  b.renter_id && b.host_id &&
  b.host_id !== FORBIDDEN_HOST_ID &&
  b.booking_ref !== FORBIDDEN_BOOKING_CODE)

const booking = usable[0]
// A second, distinct booking to play the "stranger's booking" in the
// booking_id-forgery check below. Any other booking works — the attack
// doesn't require any relationship to the attacker, that's the whole point.
const otherBooking = usable.find(b => b.id !== booking?.id)

if (!booking) {
  console.error('BLOCKED: no usable booking found that is not the forbidden host/booking.')
  process.exit(1)
}
if (!otherBooking) {
  console.error('BLOCKED: need a second, distinct booking for the booking_id-forgery check.')
  process.exit(1)
}

const convoBefore = (await admin(`conversations?select=id,last_message_at&booking_id=eq.${booking.id}`)).body[0]
if (!convoBefore) {
  console.error(`BLOCKED: booking ${booking.id} has no conversation row.`)
  process.exit(1)
}
const convoId = convoBefore.id
const originalLastMessageAt = convoBefore.last_message_at

console.log(`Using booking ${booking.id} / conversation ${convoId} (host ${booking.host_id}, renter ${booking.renter_id})`)
console.log(`Using booking ${otherBooking.id} as the "stranger's booking" for the forgery check`)

const createdMessageIds = []
let probeUserId = null
let bookinglessConvoId = null

try {
  // ---- Check 1: old-shape INSERT still works -----------------------------
  // Byte-for-byte what the deployed useConversation.send() sends today: no
  // conversation_id field at all. The Task 3 BEFORE INSERT trigger fills it,
  // and Postgres evaluates RLS WITH CHECK after BEFORE ROW triggers — this
  // must keep holding after the policy swap.
  const oldShape = await asUser(renterTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({
      booking_id: booking.id,
      sender_id: booking.renter_id,
      content: 'rls-probe old-shape insert',
    }),
  })
  const oldShapeRow = Array.isArray(oldShape.body) ? oldShape.body[0] : null
  if (oldShapeRow?.id) createdMessageIds.push(oldShapeRow.id)
  check('old-shape insert (no conversation_id field) returns 201',
    oldShape.status === 201, `status ${oldShape.status} body ${JSON.stringify(oldShape.body)}`)
  check('old-shape insert row has conversation_id filled by the trigger',
    oldShapeRow?.conversation_id === convoId, `got ${oldShapeRow?.conversation_id}`)

  // Seed a second message from the host via the service role, purely so
  // checks 2/3/5 below have a row whose sender is NOT the acting renter.
  const seededRes = await admin('messages', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: convoId,
      booking_id: booking.id,
      sender_id: booking.host_id,
      content: 'rls-probe seeded from host',
    }),
  })
  const seeded = seededRes.body[0]
  createdMessageIds.push(seeded.id)

  // ---- Check 2: participant READ works ------------------------------------
  const asRenter = await asUser(renterTok, `messages?select=id&conversation_id=eq.${convoId}`)
  check('a participant (renter) can read the conversation\'s messages',
    asRenter.status === 200 && Array.isArray(asRenter.body) && asRenter.body.length >= 2,
    `status ${asRenter.status} count ${asRenter.body?.length}`)

  const asHost = await asUser(hostTok, `messages?select=id&conversation_id=eq.${convoId}`)
  check('a participant (host) can read the conversation\'s messages',
    asHost.status === 200 && Array.isArray(asHost.body) && asHost.body.length >= 2,
    `status ${asHost.status} count ${asHost.body?.length}`)

  // ---- Check 3: read receipts still work -----------------------------------
  const upd = await asUser(renterTok, `messages?id=eq.${seeded.id}`, {
    method: 'PATCH', body: JSON.stringify({ is_read: true }),
  })
  const afterRead = (await admin(`messages?select=is_read&id=eq.${seeded.id}`)).body[0]
  check('participant can mark a message read (read receipts), verified via admin re-read',
    afterRead?.is_read === true, `PATCH status ${upd.status}, is_read now ${afterRead?.is_read}`)

  // ---- Check 5: content tampering is still blocked -------------------------
  const tamper = await asUser(renterTok, `messages?id=eq.${seeded.id}`, {
    method: 'PATCH', body: JSON.stringify({ content: 'TAMPERED' }),
  })
  const afterTamper = (await admin(`messages?select=content&id=eq.${seeded.id}`)).body[0]
  check('participant cannot rewrite message content, verified via admin re-read',
    afterTamper?.content === 'rls-probe seeded from host',
    `PATCH status ${tamper.status}, content is now ${afterTamper?.content}`)

  // ---- Check 6 (fix round 1, MINOR 4): sender_id tampering is blocked too --
  // sender_id forgery is precisely what the INSERT policy exists to prevent;
  // guarding content but not sender_id would be arbitrary. seeded.sender_id
  // is the host — the renter attempts to relabel it as themselves.
  const senderTamper = await asUser(renterTok, `messages?id=eq.${seeded.id}`, {
    method: 'PATCH', body: JSON.stringify({ sender_id: booking.renter_id }),
  })
  const afterSenderTamper = (await admin(`messages?select=sender_id&id=eq.${seeded.id}`)).body[0]
  check('participant cannot rewrite message sender_id, verified via admin re-read',
    afterSenderTamper?.sender_id === booking.host_id,
    `PATCH status ${senderTamper.status}, sender_id is now ${afterSenderTamper?.sender_id}`)

  // ---- Check 7 (fix round 1, IMPORTANT 1): booking_id forgery is closed ----
  // A participant POSTs into their OWN conversation but sets booking_id to an
  // unrelated stranger's booking. Before migration 054 this succeeded and
  // stored the forged booking_id verbatim (RLS never checked it) — exploitable
  // because notifyNewMessage() resolves the email recipient from
  // message.booking_id on the admin client, bypassing RLS entirely. After 054
  // the trigger must overwrite booking_id with the conversation's own value.
  const forge = await asUser(renterTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: convoId,
      booking_id: otherBooking.id,
      sender_id: booking.renter_id,
      content: 'rls-probe booking_id forgery attempt',
    }),
  })
  const forgeRow = Array.isArray(forge.body) ? forge.body[0] : null
  if (forgeRow?.id) createdMessageIds.push(forgeRow.id)
  check('a forged booking_id (a stranger\'s booking) is overwritten to the conversation\'s own booking_id',
    forge.status === 201 && forgeRow?.booking_id === booking.id && forgeRow?.booking_id !== otherBooking.id,
    `status ${forge.status} stored booking_id ${forgeRow?.booking_id} (sent ${otherBooking.id}, expected ${booking.id})`)

  // ---- Check 4: a NON-PARTICIPANT is blocked --------------------------------
  // Create a throwaway third account that is neither the renter nor host on
  // this conversation. Uses the GoTrue admin endpoint (service role) so the
  // account is pre-confirmed and signIn() works immediately — no email step.
  const rand = Math.random().toString(36).slice(2, 10)
  const probeEmail = `probe-${rand}@example.com`
  const probePassword = `Probe-${rand}-Aa1!`

  const createRes = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: probeEmail, password: probePassword, email_confirm: true }),
  })
  const createJson = await createRes.json()
  probeUserId = createJson?.id ?? null
  if (!probeUserId) {
    throw new Error(`could not create throwaway probe account: ${JSON.stringify(createJson)}`)
  }
  console.log(`Created throwaway probe account ${probeEmail} (${probeUserId})`)

  const probeTok = await signIn(probeEmail, probePassword)
  const asProbe = await asUser(probeTok, `messages?select=id&conversation_id=eq.${convoId}`)
  check('a NON-PARTICIPANT reads ZERO messages from this (booking-tied) conversation',
    asProbe.status === 200 && Array.isArray(asProbe.body) && asProbe.body.length === 0,
    `status ${asProbe.status} count ${asProbe.body?.length} body ${JSON.stringify(asProbe.body)}`)

  // Belt-and-braces: the non-participant must not be able to write into this
  // conversation either (insert policy also pivots on conversations now).
  const probeInsert = await asUser(probeTok, 'messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: convoId, booking_id: booking.id,
                            sender_id: probeUserId, content: 'should be rejected' }),
  })
  check('a NON-PARTICIPANT cannot insert into this conversation',
    probeInsert.status >= 400, `status ${probeInsert.status} body ${JSON.stringify(probeInsert.body)}`)
  if (probeInsert.status < 400 && Array.isArray(probeInsert.body) && probeInsert.body[0]?.id) {
    createdMessageIds.push(probeInsert.body[0].id)
  }

  // ---- Check 8 (fix round 1, IMPORTANT 2): a BOOKINGLESS conversation works
  // Nothing in the suite so far discriminates old vs new policy, because
  // every message above still carries a real booking_id and the OLD policy
  // (pivoted on booking_id) would have passed checks 2/4 too. This is the
  // test that actually proves the pivot: seed a conversation with
  // booking_id = null (the pre-booking-inquiry shape Task 5 will create) and
  // one message on it, then confirm a participant CAN read it (would have
  // FAILED under the old policy — there is no booking row to join to) and the
  // non-participant still reads zero.
  const seedConvo = await admin('conversations', {
    method: 'POST',
    body: JSON.stringify({
      listing_id: booking.listing_id,
      renter_id: booking.renter_id,
      host_id: booking.host_id,
      booking_id: null,
    }),
  })
  if (seedConvo.status !== 201 || !seedConvo.body?.[0]?.id) {
    throw new Error(`could not seed a bookingless conversation: status ${seedConvo.status} body ${JSON.stringify(seedConvo.body)}`)
  }
  bookinglessConvoId = seedConvo.body[0].id
  console.log(`Seeded bookingless conversation ${bookinglessConvoId}`)

  const bookinglessMsg = await admin('messages', {
    method: 'POST',
    body: JSON.stringify({
      conversation_id: bookinglessConvoId,
      booking_id: null,
      sender_id: booking.renter_id,
      content: 'rls-probe bookingless inquiry',
    }),
  })
  const bookinglessMsgRow = bookinglessMsg.body[0]

  const asRenterBookingless = await asUser(renterTok, `messages?select=id&conversation_id=eq.${bookinglessConvoId}`)
  check('a participant CAN read a bookingless (pre-booking-inquiry) conversation\'s messages',
    asRenterBookingless.status === 200 && Array.isArray(asRenterBookingless.body) && asRenterBookingless.body.length === 1,
    `status ${asRenterBookingless.status} count ${asRenterBookingless.body?.length}`)

  const asProbeBookingless = await asUser(probeTok, `messages?select=id&conversation_id=eq.${bookinglessConvoId}`)
  check('a NON-PARTICIPANT reads ZERO messages from the bookingless conversation',
    asProbeBookingless.status === 200 && Array.isArray(asProbeBookingless.body) && asProbeBookingless.body.length === 0,
    `status ${asProbeBookingless.status} count ${asProbeBookingless.body?.length}`)

  // Clean up the bookingless message now (the conversation itself is cleaned
  // up in the finally block below, alongside probe-account teardown).
  if (bookinglessMsgRow?.id) {
    await admin(`messages?id=eq.${bookinglessMsgRow.id}`, { method: 'DELETE' })
  }

} finally {
  // ---- Cleanup --------------------------------------------------------------
  for (const id of createdMessageIds) {
    await admin(`messages?id=eq.${id}`, { method: 'DELETE' })
  }
  // The AFTER INSERT trigger bumps conversations.last_message_at on every
  // insert above (including the rejected probe insert, if it somehow landed).
  // Deleting the messages does not unbump it — restore explicitly.
  await admin(`conversations?id=eq.${convoId}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_message_at: originalLastMessageAt }),
  })

  // The bookingless conversation was created wholesale by this script — delete
  // it outright (not "restore", there is nothing to restore it to). Any
  // remaining message on it cascades on delete regardless, but it was already
  // explicitly deleted above.
  if (bookinglessConvoId) {
    await admin(`conversations?id=eq.${bookinglessConvoId}`, { method: 'DELETE' })
  }

  if (probeUserId) {
    await fetch(`${URL}/auth/v1/admin/users/${probeUserId}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
    console.log(`Deleted throwaway probe account ${probeUserId}`)
  }
}

done()
