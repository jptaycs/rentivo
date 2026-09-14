// Verifies migration 083: request_payout(), mark_payout_paid() and
// mark_payout_failed() no longer exist, while the payout-statement surface that
// replaced them (082) still does.
//
// The refusals must be NOT-FOUND (PostgREST PGRST202), not permission denied:
// a permission error would mean the function is still there and only its grant
// moved. Each refusal is paired with a control calling a function that should
// exist, the same way, and getting past PostgREST's lookup into the function
// body (a real validation error from the RPC itself).
//
// Read-only against the database apart from one throwaway @example.com host,
// created for the my_payout_balance control and deleted afterwards. No
// lifecycle RPC is called with arguments that could succeed: every one gets a
// random UUID and raises inside its own body, so nothing commits and no
// statement number can be consumed.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/083-drop-legacy-payout-functions.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { URL as SUPABASE_URL, ANON, SECRET, admin, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const ADMIN_EMAIL = 'verify-083@example.com'

async function rpc(fn, args, token) {
  const key = token === 'service' ? SECRET : ANON
  const bearer = token === 'service' ? SECRET : token ?? ANON
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const show = (r) => `${r.status} ${JSON.stringify(r.body)}`
const notFound = (r) => r.status === 404 && r.body?.code === 'PGRST202'
// Past PostgREST's function lookup and raised inside the body: a Postgres
// exception (P0001) rather than a routing or permission error.
const raisedInBody = (r, re) => r.status >= 400 && r.body?.code === 'P0001' && re.test(r.body?.message ?? '')

function sql(query) {
  const out = execFileSync('supabase', ['db', 'query', '--linked', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(out.slice(out.indexOf('{'))).rows
}

const counts = async () => {
  const out = {}
  for (const t of ['bookings', 'listings', 'profiles', 'payout_requests', 'payout_accounts', 'admin_actions', 'notifications'])
    out[t] = (await admin(`${t}?select=id`)).body?.length ?? -1
  out.payout_items = (await admin('payout_items?select=booking_id')).body?.length ?? -1
  out.counters = JSON.stringify((await admin('payout_statement_counters?select=year,last_number&order=year')).body)
  return out
}
const forbidden = async () =>
  JSON.stringify({
    h: (await admin(`profiles?select=suspended_at,full_name&id=eq.${FORBIDDEN_HOST}`)).body,
    b: (await admin(`bookings?select=status,updated_at&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)).body,
  })

const before = await counts()
const forbiddenBefore = await forbidden()
let hostId = null

try {
  // ── 1. The catalog: none of the three exist in public ────────────────────
  const rows = sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('request_payout','mark_payout_paid','mark_payout_failed')`)
  check('1. pg_proc holds no request_payout / mark_payout_paid / mark_payout_failed in public', rows.length === 0, JSON.stringify(rows))

  // ── 2. A throwaway host for the authenticated calls ──────────────────────
  const email = `probe-083-host-${Date.now()}@example.com`
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  }).then((r) => r.json())
  if (!created.id) throw new Error('createUser: ' + JSON.stringify(created))
  hostId = created.id
  const hostToken = await signIn(email, PW)

  // ── 3. Refusals: not found, never permission denied ──────────────────────
  const legacyId = randomUUID()
  const rpHost = await rpc('request_payout', {}, hostToken)
  check('3. host calling request_payout → 404 PGRST202 (not permission denied)', notFound(rpHost), show(rpHost))
  const rpService = await rpc('request_payout', {}, 'service')
  check('3. service role calling request_payout → 404 PGRST202', notFound(rpService), show(rpService))
  const mp = await rpc('mark_payout_paid', { p_request_id: legacyId, p_reference: 'X' }, 'service')
  check('3. service role calling mark_payout_paid → 404 PGRST202', notFound(mp), show(mp))
  const mf = await rpc('mark_payout_failed', { p_request_id: legacyId, p_notes: 'X' }, 'service')
  check('3. service role calling mark_payout_failed → 404 PGRST202', notFound(mf), show(mf))

  // ── 4. Controls: the replacement surface exists and runs ─────────────────
  const r = randomUUID()
  const create = await rpc('create_payout_statement', { p_host_id: r, p_expected_amount: 100, p_admin_email: ADMIN_EMAIL }, 'service')
  check('4. CONTROL create_payout_statement exists and raises in its body ("Host not found.")', raisedInBody(create, /Host not found/), show(create))
  for (const fn of ['issue_payout_statement', 'cancel_payout_statement', 'reverse_payout_statement']) {
    const args = fn === 'issue_payout_statement'
      ? { p_request_id: r, p_reference: 'X', p_transferred_on: '2026-01-01', p_admin_email: ADMIN_EMAIL }
      : { p_request_id: r, p_reason: 'X', p_admin_email: ADMIN_EMAIL }
    const out = await rpc(fn, args, 'service')
    check(`4. CONTROL ${fn} exists and raises in its body`, out.status >= 400 && out.body?.code === 'P0001', show(out))
  }
  const owed = await rpc('payouts_owed', { p_host_id: null }, 'service')
  check('4. CONTROL payouts_owed exists and returns rows to the service role', owed.status === 200 && Array.isArray(owed.body), show(owed).slice(0, 200))
  const balance = await rpc('my_payout_balance', {}, hostToken)
  check('4. CONTROL my_payout_balance callable by a signed-in throwaway host', balance.status === 200, show(balance))
  const balanceAnon = await rpc('my_payout_balance', {}, null)
  check('4. CONTROL my_payout_balance still refuses anon', balanceAnon.status !== 200, show(balanceAnon))
} catch (e) {
  check('SCRIPT completed without throwing', false, String(e?.stack ?? e))
} finally {
  if (hostId) {
    await admin(`rate_limit_hits?key=like.*${hostId}*`, { method: 'DELETE' })
    await admin(`notifications?user_id=eq.${hostId}`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${hostId}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${hostId}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
    const gone = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${hostId}`, {
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
    const profile = (await admin(`profiles?select=id&id=eq.${hostId}`)).body ?? []
    check('TEARDOWN throwaway host re-read and gone (auth + profile)', gone.status === 404 && profile.length === 0, `${gone.status} ${profile.length}`)
  }
  const after = await counts()
  for (const k of Object.keys(before))
    check(`BASELINE ${k} unchanged`, before[k] === after[k], `${before[k]} -> ${after[k]}`)
  check('BASELINE forbidden host and booking untouched', forbiddenBefore === (await forbidden()))
  done()
}
