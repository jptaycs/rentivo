// Verification for migration 053: messages RLS moved from bookings onto
// conversations. Exercises every currently-deployed client path (old-shape
// insert with no conversation_id, participant read, read-receipt update) plus
// the two checks the policy swap exists for (non-participant blocked, content
// tampering blocked). All access assertions go through asUser() with a real
// signed-in session — admin() is used only for setup, independent assertion
// of stored state, and cleanup.
import { admin, asUser, signIn, check, done, URL, SECRET } from './env.mjs'

const FORBIDDEN_HOST_ID = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68' // Isse Capucao — do not touch
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

const hostTok   = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')

// Find a booking the demo renter/host are party to, and its conversation.
// Deliberately excludes the forbidden host — 048/task briefs across this repo
// name that host and booking as off-limits for probe writes.
const bookings = (await admin('bookings?select=id,renter_id,host_id,booking_ref&limit=200')).body
const booking = bookings.find(b =>
  b.renter_id && b.host_id &&
  b.host_id !== FORBIDDEN_HOST_ID &&
  b.booking_ref !== FORBIDDEN_BOOKING_CODE)

if (!booking) {
  console.error('BLOCKED: no usable booking found that is not the forbidden host/booking.')
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

const createdMessageIds = []
let probeUserId = null

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
  check('a NON-PARTICIPANT reads ZERO messages from this conversation',
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

  if (probeUserId) {
    await fetch(`${URL}/auth/v1/admin/users/${probeUserId}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
    console.log(`Deleted throwaway probe account ${probeUserId}`)
  }
}

done()
