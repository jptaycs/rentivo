// Verifies migration 060 (messages.booking_id dropped): the column, its index,
// FK and shim trigger are gone; every booking still has a conversation (the
// shim's self-heal role is no longer needed); the new-shape insert, the
// old-shape insert (now rejected), create_inquiry, RLS membership and the
// cascade chain bookings -> conversations -> messages all behave. Real
// sessions for authorisation; admin for setup/re-reads/cleanup.
import { URL as SUPABASE_URL, ANON, admin, asUser, signIn } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }
const rpc = async (tok, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const sub = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sub

const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const hostTok = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
const renterId = sub(renterTok), hostId = sub(hostTok)

const baseline = async () => ({
  conversations: (await admin('conversations?select=id')).body.length,
  messages: (await admin('messages?select=id')).body.length,
  bookings: (await admin('bookings?select=id')).body.length,
  notifications: (await admin('notifications?select=id')).body.length,
})
const before = await baseline()
const runStart = new Date().toISOString()

// ── Schema ──
const colProbe = await admin('messages?select=booking_id&limit=1')
check('messages.booking_id column is gone', colProbe.status === 400 && /booking_id/.test(JSON.stringify(colProbe.body)), `${colProbe.status}`)
const okCols = await admin('messages?select=id,conversation_id,sender_id,content&limit=1')
check('remaining message columns still select', okCols.status === 200)

// ── Every booking still has exactly one conversation ──
const { body: bookings } = await admin('bookings?select=id')
const { body: convos } = await admin('conversations?select=id,booking_id&booking_id=not.is.null')
const covered = new Set(convos.map((c) => c.booking_id))
check('every booking has a conversation (shim self-heal no longer needed)', bookings.every((b) => covered.has(b.id)), `${bookings.length} bookings, ${covered.size} attached conversations`)

// ── New-shape insert on a real booking thread (demo renter <-> demo host) ──
const { body: threads } = await admin(`conversations?select=id,booking_id&renter_id=eq.${renterId}&host_id=eq.${hostId}&booking_id=not.is.null&limit=1`)
const thread = threads[0]
check('setup: found a demo renter/host booking thread', !!thread)
const ins = await asUser(renterTok, 'messages', { method: 'POST', body: JSON.stringify({ conversation_id: thread.id, sender_id: renterId, content: 'probe 060 new shape' }) })
check('renter: new-shape insert (conversation_id only) -> 201', ins.status === 201, `${ins.status} ${JSON.stringify(ins.body).slice(0, 80)}`)
const probeMsgId = ins.body?.[0]?.id
const hostRead = await asUser(hostTok, `messages?select=id,content&id=eq.${probeMsgId}`)
check('host: can read it (RLS via conversation membership)', hostRead.status === 200 && hostRead.body.length === 1)
const { body: [touched] } = await admin(`conversations?select=last_message_at&id=eq.${thread.id}`)
check('touch trigger still bumps last_message_at', touched.last_message_at >= runStart, touched.last_message_at)

// ── Old-shape insert is now rejected outright ──
const old = await asUser(renterTok, 'messages', { method: 'POST', body: JSON.stringify({ booking_id: thread.booking_id, sender_id: renterId, content: 'probe 060 old shape' }) })
check('renter: old-shape insert (booking_id) rejected', old.status === 400 && /booking_id/.test(JSON.stringify(old.body)), `${old.status} ${JSON.stringify(old.body).slice(0, 90)}`)

// ── A stranger still cannot post into the thread ──
const stranger = await asUser(hostTok, 'messages', { method: 'POST', body: JSON.stringify({ conversation_id: thread.id, sender_id: renterId, content: 'spoofed sender' }) })
check('host: cannot insert with a spoofed sender_id', stranger.status >= 400, `${stranger.status}`)

// ── create_inquiry still works without the column ──
const { body: listings } = await admin(`listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&host_id=neq.${renterId}&host_id=neq.${FORBIDDEN_HOST}&limit=10`)
let listing = null
for (const l of listings) {
  const { body: open } = await admin(`conversations?select=id&listing_id=eq.${l.id}&renter_id=eq.${renterId}&booking_id=is.null`)
  if (open.length === 0) { listing = l; break }
}
const inq = await rpc(renterTok, 'create_inquiry', { p_listing_id: listing.id, p_content: 'probe 060 inquiry' })
check('create_inquiry -> conversation id', inq.status === 200 && typeof inq.body === 'string', `${inq.status} ${JSON.stringify(inq.body).slice(0, 80)}`)
const { body: inqMsgs } = await admin(`messages?select=id,content&conversation_id=eq.${inq.body}`)
check('inquiry message written', inqMsgs.length === 1 && inqMsgs[0].content === 'probe 060 inquiry')

// ── Cascade chain: deleting a booking still removes its messages ──
const bk = await rpc(renterTok, 'create_booking', {
  p_listing_id: listing.id, p_pickup_date: '2027-06-10', p_return_date: '2027-06-12',
  p_is_delivery: false, p_delivery_address: null, p_payment_method: 'qrph', p_promo_code: null,
})
check('setup: booking created (attaches the inquiry)', bk.status === 200 && bk.body?.id)
const { body: [attached] } = await admin(`conversations?select=booking_id&id=eq.${inq.body}`)
check('inquiry attached to the booking', attached?.booking_id === bk.body?.id)
const delBk = await admin(`bookings?id=eq.${bk.body.id}`, { method: 'DELETE' })
check('booking deleted', delBk.status === 200 && delBk.body.length === 1)
const { body: goneConvo } = await admin(`conversations?select=id&id=eq.${inq.body}`)
const { body: goneMsgs } = await admin(`messages?select=id&conversation_id=eq.${inq.body}`)
check('cascade: conversation and its messages gone with the booking', goneConvo.length === 0 && goneMsgs.length === 0)

// ── Cleanup ──
await admin(`messages?id=eq.${probeMsgId}`, { method: 'DELETE' })
await admin(`notifications?user_id=eq.${listing.host_id}&created_at=gte.${runStart}`, { method: 'DELETE' })
// last_message_at on the demo thread was bumped by the probe; restore from the newest surviving message.
const { body: rest } = await admin(`messages?select=created_at&conversation_id=eq.${thread.id}&order=created_at.desc&limit=1`)
await admin(`conversations?id=eq.${thread.id}`, { method: 'PATCH', body: JSON.stringify({ last_message_at: rest[0]?.created_at ?? null }) })
const after = await baseline()
for (const k of Object.keys(before)) check(`baseline ${k} ${before[k]} -> ${after[k]}`, before[k] === after[k])
const { body: forb } = await admin(`profiles?select=id&id=eq.${FORBIDDEN_HOST}`)
check('forbidden host untouched (exists)', forb.length === 1)
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
