// Verifies migration 058 against the hosted database with a real demo-renter
// session (RLS-scoped for every behaviour under test; admin only for setup,
// independent re-reads and cleanup):
//   1. create_inquiry refuses > 1000 chars with a readable message; 1000 passes.
//   2. messages.content CHECK (4000) refuses a direct insert of 4001 chars; 4000 passes.
//   3. attach_conversation_to_booking() reconciles conversations.host_id from
//      the booking when attaching an open inquiry.
// Every probe row is deleted afterwards; the forbidden host/booking are never touched.
import { URL as SUPABASE_URL, ANON, admin, asUser, signIn } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }
const rpc = async (tok, fn, args) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const me = JSON.parse(Buffer.from(renterTok.split('.')[1], 'base64url').toString()).sub

const baseline = async () => ({
  conversations: (await admin('conversations?select=id')).body.length,
  messages: (await admin('messages?select=id')).body.length,
  bookings: (await admin('bookings?select=id')).body.length,
  notifications: (await admin('notifications?select=id')).body.length,
})
const before = await baseline()
const runStart = new Date().toISOString()

// A live listing the renter doesn't own, not the forbidden host, and one the
// renter has no OPEN inquiry on already.
const { body: candidates } = await admin(`listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&host_id=neq.${me}&host_id=neq.${FORBIDDEN_HOST}&limit=10`)
let listing = null
for (const l of candidates) {
  const { body: open } = await admin(`conversations?select=id&listing_id=eq.${l.id}&renter_id=eq.${me}&booking_id=is.null`)
  if (open.length === 0) { listing = l; break }
}
if (!listing) throw new Error('no usable listing')

// ── 1. create_inquiry length cap ──
const tooLong = await rpc(renterTok, 'create_inquiry', { p_listing_id: listing.id, p_content: 'x'.repeat(1001) })
check('1001 chars refused', tooLong.status >= 400, `status ${tooLong.status}`)
check('refusal is the readable sentence', /too long/.test(tooLong.body?.message ?? ''), tooLong.body?.message)
const justRight = await rpc(renterTok, 'create_inquiry', { p_listing_id: listing.id, p_content: 'y'.repeat(1000) })
check('CONTROL: 1000 chars accepted', justRight.status === 200 && typeof justRight.body === 'string', `status ${justRight.status}`)
const convoId = justRight.body

// ── 2. messages.content CHECK via a direct RLS-gated insert ──
const overCap = await asUser(renterTok, 'messages', {
  method: 'POST', body: JSON.stringify({ conversation_id: convoId, sender_id: me, content: 'z'.repeat(4001) }),
})
check('direct insert of 4001 chars refused', overCap.status >= 400, `status ${overCap.status}`)
check('refused by messages_content_length', /messages_content_length/.test(JSON.stringify(overCap.body)), JSON.stringify(overCap.body).slice(0, 120))
const atCap = await asUser(renterTok, 'messages', {
  method: 'POST', body: JSON.stringify({ conversation_id: convoId, sender_id: me, content: 'z'.repeat(4000) }),
})
check('CONTROL: direct insert of 4000 chars accepted', atCap.status === 201, `status ${atCap.status}`)
const { body: msgs } = await admin(`messages?select=id&conversation_id=eq.${convoId}`)
check('conversation holds exactly the 2 accepted messages', msgs.length === 2, `${msgs.length}`)

// ── 3. host_id reconciliation on attach ──
// Corrupt the open inquiry's host_id to a different real profile, then book
// the listing for real via create_booking; the trigger must restore it.
const { body: others } = await admin(`profiles?select=id&id=neq.${listing.host_id}&id=neq.${me}&id=neq.${FORBIDDEN_HOST}&limit=1`)
const wrongHost = others[0].id
const corrupt = await admin(`conversations?id=eq.${convoId}`, { method: 'PATCH', body: JSON.stringify({ host_id: wrongHost }) })
check('setup: inquiry host_id corrupted', corrupt.status === 200 && corrupt.body[0].host_id === wrongHost)
const booking = await rpc(renterTok, 'create_booking', {
  p_listing_id: listing.id, p_pickup_date: '2027-04-10', p_return_date: '2027-04-12',
  p_is_delivery: false, p_delivery_address: null, p_payment_method: 'qrph', p_promo_code: null,
})
check('booking created via create_booking', booking.status === 200 && booking.body?.id, `status ${booking.status} ${JSON.stringify(booking.body).slice(0, 100)}`)
const { body: [after] } = await admin(`conversations?select=id,host_id,booking_id&id=eq.${convoId}`)
check('inquiry attached to the new booking (same conversation id)', after?.booking_id === booking.body?.id)
check('host_id reconciled to the booking\'s host', after?.host_id === listing.host_id && after?.host_id !== wrongHost, `${after?.host_id}`)
check('booking.host_id came from the listing', booking.body?.host_id === listing.host_id)

// ── Cleanup ──
// Deleting the booking cascades the conversation (049: on delete cascade)
// and its messages (051). Notifications written by the booking triggers are
// removed by booking link.
if (booking.body?.id) {
  // The booking trigger notifies the listing's host with a bare
  // '/dashboard/bookings' link (no booking id), so clean up by host + time.
  await admin(`notifications?user_id=eq.${listing.host_id}&created_at=gte.${runStart}`, { method: 'DELETE' }).catch(() => {})
  const del = await admin(`bookings?id=eq.${booking.body.id}`, { method: 'DELETE' })
  check('cleanup: booking deleted', del.status === 200 && del.body.length === 1)
} else {
  await admin(`conversations?id=eq.${convoId}`, { method: 'DELETE' })
}
const { body: gone } = await admin(`conversations?select=id&id=eq.${convoId}`)
check('cleanup: conversation cascaded away', gone.length === 0)
const afterAll = await baseline()
for (const k of Object.keys(before)) check(`baseline ${k} ${before[k]} -> ${afterAll[k]}`, before[k] === afterAll[k])
const { body: forb } = await admin(`profiles?select=id&id=eq.${FORBIDDEN_HOST}`)
check('forbidden host row untouched (exists)', forb.length === 1)
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
