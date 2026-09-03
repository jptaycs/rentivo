// Verifies the billing HTTP routes against a dev server on :3100 and the
// hosted database. Run: node scripts/verify/064-bill-routes.mjs
import { readFileSync } from 'node:fs'
import { URL as SUPABASE_URL, ANON, admin } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const CRON_SECRET = (readFileSync('.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m) ?? [])[1]?.trim()
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }

async function signInFull(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  const json = await res.json(); if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json)}`); return json
}
function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`).join('; ')
}
export { APP, check, signInFull, cookieHeaderFor, admin }

const adminCookie = cookieHeaderFor(await signInFull('demo@demo.rentivo.ph', 'DemoRentivo1'))
const renterCookie = cookieHeaderFor(await signInFull('renter@demo.rentivo.ph', 'DemoRentivo1'))

// ── cron route ──
const noSecret = await fetch(`${APP}/api/cron/host-bills`)
check('cron: 401 without secret', noSecret.status === 401, `${noSecret.status}`)
const wrong = await fetch(`${APP}/api/cron/host-bills`, { headers: { Authorization: 'Bearer nope' } })
check('cron: 401 with wrong secret', wrong.status === 401, `${wrong.status}`)
const ok = await fetch(`${APP}/api/cron/host-bills`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })
const okBody = await ok.json()
const cronOk = ok.status === 200 && /^\d{4}-\d{2}-01$/.test(okBody.period) && typeof okBody.created === 'number'
if (cronOk && okBody.created !== 0) {
  console.log(`WARNING: cron run created real bills — investigate before re-running (period ${okBody.period}, created ${okBody.created})`)
}
check('cron: 200 with secret, reports previous month, created 0', cronOk && okBody.created === 0, `${ok.status} ${JSON.stringify(okBody)}`)

// ── admin run route ──
const anonRun = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026-01' }) })
check('admin run: 404 signed out', anonRun.status === 404, `${anonRun.status}`)
const renterRun = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: renterCookie }, body: JSON.stringify({ period: '2026-01' }) })
check('admin run: 404 as non-admin', renterRun.status === 404, `${renterRun.status}`)
const badPeriod = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ period: 'nope' }) })
check('admin run: 400 on a malformed period', badPeriod.status === 400, `${badPeriod.status}`)
const futurePeriod = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ period: '2099-01' }) })
const futureBody = await futurePeriod.json()
check('admin run: 400 on a future period', futurePeriod.status === 400 && typeof futureBody.error === 'string' && futureBody.error.includes('completed month'), `${futurePeriod.status} ${JSON.stringify(futureBody)}`)
const goodRun = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ period: '2026-01' }) })
const goodBody = await goodRun.json()
check('admin run: 200 as admin, created 0 for a pre-POLICY_START month', goodRun.status === 200 && goodBody.period === '2026-01-01' && goodBody.created === 0, `${goodRun.status} ${JSON.stringify(goodBody)}`)

if (!process.env.BILL_ROUTES_CONTINUE) { console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0) }
