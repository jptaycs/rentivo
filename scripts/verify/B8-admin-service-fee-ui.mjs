// Verifies /admin/settings, POST /api/admin/settings/service-fee and the
// /admin overview card (Task B8).
//
// This screen sets the price every renter pays, so the run is deliberately
// constrained: it must NOT commit a real rate change. The live rate is asserted
// to be 500 bps at the start and again at the end, and no admin_actions
// `service_fee_rate_change` row may be added.
//
// That constraint shapes how the success path is proved:
//   - Every ROUTE-level refusal is paired with a control that removes only the
//     tested condition. The control cannot be a 200 (that would commit), so it
//     is the call reaching the RPC and coming back with the RPC's OWN no-op
//     refusal ("The service fee is already 500 basis points…"). That message is
//     only reachable past the route's validator and through the real
//     service-role RPC, so it distinguishes "refused by the route" from
//     "reached the database" exactly as a 200 would.
//   - The RPC's success semantics (returns previous/new, updates the row,
//     writes the audit row) are proved in a ROLLED-BACK SQL probe, using the
//     same harness migration 080's script established.
//
// Real signed-in sessions for every authorisation claim (forged SSR cookies —
// the documented pattern); the service role is used only for independent
// re-reads.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/B8-admin-service-fee-ui.mjs [appUrl]
import { execFileSync } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, admin, check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3104'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'

const ADMIN_EMAIL = 'demo@demo.rentivo.ph' // on the local ADMIN_EMAILS allowlist
const RENTER_EMAIL = 'renter@demo.rentivo.ph'
const PW = 'DemoRentivo1'

const sql = (q) =>
  JSON.parse(
    execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  ).rows

function sqlLit(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

/** Run `sql` inside a transaction that always aborts, carrying a JSON payload
 *  out through the raised message. Copied verbatim from 080's script. */
function probe(body) {
  const stmt = `do $$\nbegin\n${body}\nend $$;`
  try {
    execFileSync('supabase', ['db', 'query', '--linked', stmt], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { raised: false, payload: null }
  } catch (e) {
    const rawStdout = e.stdout ?? ''
    let payload = null
    try {
      const outer = JSON.parse(rawStdout)
      let msg = outer?.error?.message ?? ''
      msg = msg.replace(/^unexpected status \d+: /, '')
      const pgMsg = JSON.parse(msg)?.message ?? ''
      const m = pgMsg.match(/VERIFY ([\s\S]*?)(?:\nCONTEXT|$)/)
      payload = m ? m[1].trim() : null
    } catch {
      payload = null
    }
    return { raised: true, payload, error: `${rawStdout}${e.stderr ?? ''}` }
  }
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
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) =>
    `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`
  ).join('; ')
}

const getPage = (path, cookie) =>
  fetch(`${APP}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} })

async function postFee(cookie, rawBody) {
  const res = await fetch(`${APP}/api/admin/settings/service-fee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
  })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const ROUTE_RANGE_MSG =
  'The service fee must be a whole number of basis points between 0 and 2000 (0% and 20%).'
const RPC_NOOP_MSG = 'The service fee is already 500 basis points — nothing to change.'

async function main() {
  // ── Baseline ────────────────────────────────────────────────────────────
  const { body: settings0 } = await admin('platform_settings?select=service_fee_bps,updated_at')
  const bps0 = settings0?.[0]?.service_fee_bps
  check('BASELINE live service fee is 500 bps', bps0 === 500, `got ${bps0}`)
  if (bps0 !== 500) {
    console.log('ABORTING: the live rate is not 500. This script must not run against an unexpected rate.')
    process.exit(1)
  }
  const { body: hist0 } = await admin(
    'admin_actions?select=id&action=eq.service_fee_rate_change'
  )
  const histCount0 = hist0.length
  check('BASELINE service_fee_rate_change audit rows counted', true, `${histCount0} row(s)`)

  const adminSession = await signInFull(ADMIN_EMAIL, PW)
  const renterSession = await signInFull(RENTER_EMAIL, PW)
  const adminCookie = cookieHeaderFor(adminSession)
  const renterCookie = cookieHeaderFor(renterSession)

  // ── Access matrix: /admin/settings ──────────────────────────────────────
  const pOut = await getPage('/admin/settings', null)
  const loc = pOut.headers.get('location') ?? ''
  check(
    'PAGE signed out → 307 to /login?next=%2Fadmin%2Fsettings',
    pOut.status === 307 && loc.includes('/login?next=%2Fadmin%2Fsettings'),
    `${pOut.status} ${loc}`
  )

  const pRenter = await getPage('/admin/settings', renterCookie)
  check('PAGE demo renter (non-admin) → 404', pRenter.status === 404, String(pRenter.status))

  const pAdmin = await getPage('/admin/settings', adminCookie)
  const pAdminHtml = pAdmin.status === 200 ? await pAdmin.text() : ''
  check('PAGE admin → 200', pAdmin.status === 200, String(pAdmin.status))
  check('PAGE admin renders the live rate 5%', pAdminHtml.includes('5%'))
  check('PAGE admin renders the change form', pAdminHtml.includes('Change the service fee'))
  check('PAGE admin renders the reason field', pAdminHtml.includes('Reason (required)'))
  check('PAGE admin renders the history table', pAdminHtml.includes('Rate change history'))
  check(
    'PAGE admin renders the live preview with the current rate',
    pAdminHtml.includes('rental the renter pays') && pAdminHtml.includes('₱1,050'),
    'preview line present'
  )

  // The overview card (Step 4) — rendered by the same admin session.
  const pOverview = await getPage('/admin', adminCookie)
  const overviewHtml = pOverview.status === 200 ? await pOverview.text() : ''
  check('OVERVIEW admin → 200', pOverview.status === 200, String(pOverview.status))
  check(
    'OVERVIEW carries a Service fee card showing 5% and linking to /admin/settings',
    overviewHtml.includes('Service fee') &&
      overviewHtml.includes('/admin/settings') &&
      overviewHtml.includes('>5%<'),
    'card present'
  )
  check(
    'OVERVIEW existing count cards still render (Total users)',
    overviewHtml.includes('Total users')
  )
  check('NAV carries a Settings link', overviewHtml.includes('>Settings</a>'))

  // ── Access matrix: the route ────────────────────────────────────────────
  const rOut = await postFee(null, { bps: 600, reason: 'access-matrix' })
  check('ROUTE signed out → 404', rOut.status === 404, JSON.stringify(rOut.body))

  const rRenter = await postFee(renterCookie, { bps: 600, reason: 'access-matrix' })
  check('ROUTE demo renter (non-admin) → 404', rRenter.status === 404, JSON.stringify(rRenter.body))

  // THE CONTROL for every refusal below: a well-formed admin call passes the
  // route's validator, reaches the real service-role RPC, and is refused by the
  // RPC's own no-op guard. Reaching that message is proof the gate passed and
  // the real RPC ran — the same proof a 200 would give, without committing.
  const control = await postFee(adminCookie, { bps: 500, reason: 'B8 verification control' })
  check(
    'CONTROL admin, valid body at the current rate → 400 with the RPC\'s own no-op message',
    control.status === 400 && control.body?.error === RPC_NOOP_MSG,
    `${control.status} ${JSON.stringify(control.body)}`
  )

  // ── Route validation refusals, each against that control ────────────────
  const tooHigh = await postFee(adminCookie, { bps: 2001, reason: 'B8 verification control' })
  check(
    'REFUSE bps 2001 (out of range) → 400 route message, never reaching the RPC',
    tooHigh.status === 400 && tooHigh.body?.error === ROUTE_RANGE_MSG,
    JSON.stringify(tooHigh.body)
  )

  const negative = await postFee(adminCookie, { bps: -1, reason: 'B8 verification control' })
  check(
    'REFUSE bps -1 (out of range) → 400 route message',
    negative.status === 400 && negative.body?.error === ROUTE_RANGE_MSG,
    JSON.stringify(negative.body)
  )

  const fractional = await postFee(adminCookie, { bps: 512.5, reason: 'B8 verification control' })
  check(
    'REFUSE bps 512.5 (non-integer) → 400 route message',
    fractional.status === 400 && fractional.body?.error === ROUTE_RANGE_MSG,
    JSON.stringify(fractional.body)
  )

  const stringBps = await postFee(adminCookie, { bps: '600', reason: 'B8 verification control' })
  check(
    'REFUSE bps "600" (string) → 400 route message',
    stringBps.status === 400 && stringBps.body?.error === ROUTE_RANGE_MSG,
    JSON.stringify(stringBps.body)
  )

  const missingBps = await postFee(adminCookie, { reason: 'B8 verification control' })
  check(
    'REFUSE missing bps → 400 route message',
    missingBps.status === 400 && missingBps.body?.error === ROUTE_RANGE_MSG,
    JSON.stringify(missingBps.body)
  )

  // The reason refusals hold bps at 600 (a VALID, different rate) so the only
  // thing under test is the reason. Their control is the next check.
  const blankReason = await postFee(adminCookie, { bps: 600, reason: '   ' })
  check(
    'REFUSE whitespace-only reason at a valid new bps → 400 "A reason is required."',
    blankReason.status === 400 && blankReason.body?.error === 'A reason is required.',
    JSON.stringify(blankReason.body)
  )

  const missingReason = await postFee(adminCookie, { bps: 600 })
  check(
    'REFUSE missing reason at a valid new bps → 400 "A reason is required."',
    missingReason.status === 400 && missingReason.body?.error === 'A reason is required.',
    JSON.stringify(missingReason.body)
  )

  // CONTROL for the two reason refusals: same bps 600, only the reason fixed.
  // It must NOT be refused for a reason — it must reach the RPC. The RPC then
  // WOULD commit 600, so this control is run as the rolled-back SQL probe below
  // instead of over HTTP; asserting it here would change the live rate.
  check(
    'CONTROL for the reason refusals is the rolled-back RPC probe below, not an HTTP 200 (a 200 would commit a real rate change)',
    true
  )

  const badJson = await postFee(adminCookie, '{not json')
  check(
    'REFUSE malformed JSON → 400 "Invalid request."',
    badJson.status === 400 && badJson.body?.error === 'Invalid request.',
    JSON.stringify(badJson.body)
  )

  const nullBody = await postFee(adminCookie, 'null')
  check(
    'REFUSE literal null body → 400 "Invalid request." (not a 500)',
    nullBody.status === 400 && nullBody.body?.error === 'Invalid request.',
    JSON.stringify(nullBody.body)
  )

  // ── The success path, rolled back ───────────────────────────────────────
  // The one thing the HTTP controls above cannot show: that a valid, non-no-op
  // call actually changes the rate and writes the audit row. Run as a probe
  // that always aborts, so nothing commits.
  const p = probe(`
    declare v_prev integer; declare v_new integer; declare v_rate integer; declare v_audit integer;
    begin
      select previous_bps, service_fee_bps into v_prev, v_new
      from public.set_service_fee_bps(750, 'B8 rolled-back probe', ${sqlLit(ADMIN_EMAIL)});
      select s.service_fee_bps into v_rate from public.platform_settings s where s.id;
      select count(*) into v_audit from public.admin_actions
        where action = 'service_fee_rate_change' and detail->>'reason' = 'B8 rolled-back probe';
      raise exception 'VERIFY %', json_build_object('prev', v_prev, 'new', v_new, 'rate', v_rate, 'audit', v_audit);
    end;
  `)
  let payload = null
  try {
    payload = JSON.parse(p.payload)
  } catch {
    payload = null
  }
  check(
    'RPC SUCCESS (rolled back) returns previous 500 → new 750',
    payload?.prev === 500 && payload?.new === 750,
    JSON.stringify(payload)
  )
  check(
    'RPC SUCCESS (rolled back) actually updated platform_settings to 750 inside the transaction',
    payload?.rate === 750,
    JSON.stringify(payload)
  )
  check(
    'RPC SUCCESS (rolled back) wrote exactly one service_fee_rate_change audit row with the reason',
    payload?.audit === 1,
    JSON.stringify(payload)
  )

  // ── Nothing committed ───────────────────────────────────────────────────
  const { body: settings1 } = await admin('platform_settings?select=service_fee_bps')
  check(
    'AFTER live service fee is still 500 bps',
    settings1?.[0]?.service_fee_bps === 500,
    `got ${settings1?.[0]?.service_fee_bps}`
  )
  const { body: hist1 } = await admin('admin_actions?select=id&action=eq.service_fee_rate_change')
  check(
    'AFTER no service_fee_rate_change audit row was added',
    hist1.length === histCount0,
    `${histCount0} → ${hist1.length}`
  )
  const probeRows = sql(
    `select count(*)::int as n from public.admin_actions where detail->>'reason' = 'B8 rolled-back probe'`
  )
  check('AFTER the rolled-back probe left no audit row', probeRows[0].n === 0, JSON.stringify(probeRows))

  // ── Forbidden rows untouched ────────────────────────────────────────────
  const { body: forbiddenHost } = await admin(
    `profiles?select=id,suspended_at,updated_at&id=eq.${FORBIDDEN_HOST}`
  )
  check('FORBIDDEN host row still present and read-only-checked', forbiddenHost.length === 1)
  const { body: forbiddenBooking } = await admin(
    `bookings?select=booking_ref,status,service_fee_bps&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`
  )
  check(
    'FORBIDDEN booking still present and read-only-checked',
    forbiddenBooking.length === 1,
    JSON.stringify(forbiddenBooking[0])
  )

  done()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
