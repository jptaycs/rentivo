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

// ── pay / verify / webhook ──
// A real issued bill for the demo host, inserted with admin (generate needs
// real bookings; the pay route only needs the row).
const demoHostId = JSON.parse(Buffer.from(adminCookie.split('base64-')[1].split(';')[0], 'base64url').toString()).user.id
const { body: [probeBill] } = await admin('host_bills', { method: 'POST', body: JSON.stringify({ host_id: demoHostId, period: '2031-01-01', amount: 123, due_at: new Date(Date.now() + 14 * 864e5).toISOString() }) })
try {
  const strangerPay = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: renterCookie } })
  check('pay: 404 for a bill that is not yours', strangerPay.status === 404, `${strangerPay.status}`)
  const anonPay = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST' })
  check('pay: 401 signed out', anonPay.status === 401, `${anonPay.status}`)
  const pay = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
  const payBody = await pay.json()
  check('pay: 200 with a QR image for the owner (test-mode PayMongo)', pay.status === 200 && typeof payBody.qrImage === 'string' && payBody.qrImage.startsWith('data:image/'), `${pay.status} ${JSON.stringify(payBody).slice(0, 100)}`)
  const { body: [afterPay] } = await admin(`host_bills?select=paymongo_ref,status&id=eq.${probeBill.id}`)
  check('pay: paymongo_ref stored, still issued', /^pi_/.test(afterPay.paymongo_ref ?? '') && afterPay.status === 'issued', JSON.stringify(afterPay))

  // Confirm the intent PayMongo actually holds matches the bill: right
  // amount, and metadata carries the bill id (the webhook's stale-intent
  // fallback depends on this).
  const pmRes = await fetch(`https://api.paymongo.com/v1/payment_intents/${afterPay.paymongo_ref}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}` },
  })
  const pmBody = await pmRes.json()
  check(
    'pay: PayMongo intent amount and metadata match the bill',
    pmBody.data?.attributes?.amount === 123 * 100 && pmBody.data?.attributes?.metadata?.host_bill_id === probeBill.id,
    JSON.stringify(pmBody.data?.attributes?.metadata)
  )

  // Finding 2(a): a second click on the same still-issued bill must reuse
  // the live intent (same QR), not mint a fresh one that orphans the first.
  const pay2 = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
  const pay2Body = await pay2.json()
  check('pay: second click on a still-issued bill returns 200 with a QR (reuse path)', pay2.status === 200 && typeof pay2Body.qrImage === 'string' && pay2Body.qrImage.startsWith('data:image/'), `${pay2.status} ${JSON.stringify(pay2Body).slice(0, 100)}`)
  const { body: [afterPay2] } = await admin(`host_bills?select=paymongo_ref&id=eq.${probeBill.id}`)
  check('pay: reuse path did not mint a new intent — paymongo_ref unchanged', afterPay2.paymongo_ref === afterPay.paymongo_ref, `${afterPay2.paymongo_ref} vs ${afterPay.paymongo_ref}`)

  const verify = await fetch(`${APP}/api/bills/${probeBill.id}/verify-payment`, { method: 'POST', headers: { Cookie: adminCookie } })
  const verifyBody = await verify.json()
  check('verify-payment: unpaid intent reports unpaid/processing', verify.status === 200 && ['unpaid', 'processing'].includes(verifyBody.status), `${verify.status} ${JSON.stringify(verifyBody)}`)

  // Deletion gate (Task 6): while probeBill is still `issued` (it is, at this
  // point — the webhook replay below is what marks it paid), self-service
  // account deletion for its host (the demo host, signed in as adminCookie)
  // must be blocked with the bill wording. NEVER actually delete the demo
  // host: only run this if the demo host also has an in-flight booking, which
  // independently blocks the delete route before it can reach deleteAccount()
  // — so a 400 here can never mean the account was actually removed.
  const { body: demoHostBookings } = await admin(`bookings?select=id&host_id=eq.${demoHostId}&status=in.(pending,confirmed,active)`)
  if (demoHostBookings.length > 0) {
    const delBlocked = await fetch(`${APP}/api/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ confirm: 'DELETE' }) })
    const delBody = await delBlocked.json()
    check('account delete: 400 while a commission bill is issued', delBlocked.status === 400 && /commission bill/i.test(delBody.error ?? ''), `${delBlocked.status} ${delBody.error}`)
  } else {
    console.log('SKIP account delete gate check (demo host has no in-flight booking to make this safe)')
  }

  // Webhook replay: a signed payment.paid event for the bill's intent.
  const { createHmac } = await import('node:crypto')
  const whsec = (readFileSync('.env.local', 'utf8').match(/^PAYMONGO_WEBHOOK_SECRET=(.+)$/m) ?? [])[1]?.trim()
  if (whsec) {
    const raw = JSON.stringify({ data: { attributes: { type: 'payment.paid', data: { attributes: { payment_intent_id: afterPay.paymongo_ref } } } } })
    const ts = Math.floor(Date.now() / 1000)
    const sig = createHmac('sha256', whsec).update(`${ts}.${raw}`).digest('hex')
    const wh = await fetch(`${APP}/api/webhooks/paymongo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'paymongo-signature': `t=${ts},te=${sig},li=` }, body: raw })
    check('webhook: signed payment.paid accepted', wh.status === 200, `${wh.status}`)
    const { body: [afterWh] } = await admin(`host_bills?select=status,paid_at,paymongo_ref&id=eq.${probeBill.id}`)
    check('webhook: bill marked paid via paymongo_ref match', afterWh.status === 'paid' && afterWh.paid_at && afterWh.paymongo_ref === afterPay.paymongo_ref, JSON.stringify(afterWh))
    const payAgain = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
    check('pay: 400 on a paid bill', payAgain.status === 400, `${payAgain.status}`)
  } else {
    console.log('SKIP webhook replay (no PAYMONGO_WEBHOOK_SECRET locally) — mark paid via RPC instead')
    await admin('rpc/mark_host_bill_paid', { method: 'POST', body: JSON.stringify({ p_bill_id: probeBill.id, p_paymongo_ref: afterPay.paymongo_ref }) })
    const payAgain = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
    check('pay: 400 on a paid bill', payAgain.status === 400, `${payAgain.status}`)
  }
} finally {
  await admin(`host_bills?id=eq.${probeBill.id}`, { method: 'DELETE' })
  const { body: gone } = await admin(`host_bills?select=id&id=eq.${probeBill.id}`)
  check('cleanup: probe bill deleted', gone.length === 0)
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
