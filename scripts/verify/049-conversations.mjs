import { admin, asUser, signIn, check } from './env.mjs'

const RENTER = 'renter@demo.rentivo.ph'
const PASSWORD = 'DemoRentivo1'

// 1. The table exists and is reachable through PostgREST (grants present).
const svc = await admin('conversations?select=id&limit=1')
check('service role can read conversations', svc.status === 200, `status ${svc.status}`)

// 2. anon (no session) must read nothing. The migration grants SELECT to
//    `authenticated` only (matching this project's established convention for
//    every other participant-scoped table — bookings, messages, notifications,
//    payout_accounts, verification_requests all do the same, per 004/012/015/020),
//    so anon has no grant at all and PostgREST returns a permission-denied
//    error (42501) rather than an RLS-scoped empty array. Either shape proves
//    the real property — anon cannot read a single row — so both pass.
const anon = await asUser(null, 'conversations?select=id')
const anonBlocked =
  (anon.status === 200 && Array.isArray(anon.body) && anon.body.length === 0) ||
  (anon.status === 401 && anon.body?.code === '42501')
check('anon reads zero conversations', anonBlocked,
  `status ${anon.status} body ${JSON.stringify(anon.body)?.slice(0, 80)}`)

// 3. RLS: a signed-in user must not be able to INSERT directly — the RPC is
//    the only path. Expect a 42501 / permission or policy error, never 201.
const token = await signIn(RENTER, PASSWORD)
const listing = (await admin('listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&limit=1')).body[0]
const ins = await asUser(token, 'conversations', {
  method: 'POST',
  body: JSON.stringify({ listing_id: listing.id, renter_id: listing.host_id, host_id: listing.host_id }),
})
check('authenticated direct INSERT is rejected', ins.status !== 201, `status ${ins.status}`)

// 4. The partial unique index (conversations_open_inquiry_key) is asserted by
// the backfill in Task 2, which fails loudly if the index were unconditional
// — not re-checked here. (The brief's original Step 4 called a
// `rpc/exec_sql` endpoint that does not exist in this project; removed.)
console.log('(index shape is asserted by the backfill in Task 2, which fails loudly if unconditional)')

process.exit(0)
