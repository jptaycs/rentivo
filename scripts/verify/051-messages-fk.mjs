import { admin, asUser, check, signIn } from './env.mjs'

const msgs = (await admin('messages?select=id,booking_id,conversation_id')).body
check('messages table is readable', Array.isArray(msgs), JSON.stringify(msgs)?.slice(0, 120))
check('every message has a conversation_id',
  Array.isArray(msgs) && msgs.every(m => m.conversation_id),
  `${(msgs ?? []).filter(m => !m?.conversation_id).length} missing`)

// conversation_id must agree with the booking the message already belonged to.
const convos = (await admin('conversations?select=id,booking_id')).body
const convoById = new Map(convos.map(c => [c.id, c]))
const wrong = (msgs ?? []).filter(m => convoById.get(m.conversation_id)?.booking_id !== m.booking_id)
check('conversation_id matches the original booking_id', wrong.length === 0, `${wrong.length} wrong`)

// ── Old-shape insert (backward-compatibility shim) ──────────────────────
// The CURRENTLY DEPLOYED client inserts { booking_id, sender_id, content }
// with NO conversation_id at all. The fill_conversation_from_booking()
// BEFORE INSERT trigger must fill it in so this still works under the new
// NOT NULL constraint and RLS. Exercised as a real signed-in user via the
// anon key — never the service role, which would prove nothing.
const renterToken = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const renterId = 'a0000000-0000-4000-8000-0000000000fe'

// Find a booking this renter participates in, and its conversation.
const bookingsForRenter = (await admin(`bookings?select=id&renter_id=eq.${renterId}&limit=1`)).body
const probeBookingId = bookingsForRenter?.[0]?.id
check('found a booking for the old-shape insert probe', !!probeBookingId, probeBookingId ?? 'none found')

const expectedConvo = (await admin(`conversations?select=id&booking_id=eq.${probeBookingId}`)).body?.[0]

const oldShapeInsert = await asUser(renterToken, 'messages', {
  method: 'POST',
  body: JSON.stringify({
    booking_id: probeBookingId,
    sender_id: renterId,
    content: 'old-shape probe — deployed-client insert simulation',
  }),
})

const insertedRow = Array.isArray(oldShapeInsert.body) ? oldShapeInsert.body[0] : oldShapeInsert.body
check('old-shape insert (no conversation_id field) succeeds with 201',
  oldShapeInsert.status === 201,
  `status ${oldShapeInsert.status} — ${JSON.stringify(oldShapeInsert.body)?.slice(0, 300)}`)
check('old-shape insert row has a non-null conversation_id',
  !!insertedRow?.conversation_id,
  JSON.stringify(insertedRow)?.slice(0, 300))
check('old-shape insert conversation_id matches the conversation for that booking',
  !!expectedConvo && insertedRow?.conversation_id === expectedConvo.id,
  `got ${insertedRow?.conversation_id}, expected ${expectedConvo?.id}`)

// Clean up the probe row so this script is repeatable and leaves no trace.
if (insertedRow?.id) {
  await admin(`messages?id=eq.${insertedRow.id}`, { method: 'DELETE' })
}

process.exit(0)
