// Security audit 2, MEDIUM-4 + LOW-8: webhook signature/timestamp gate and the
// stale-intent metadata fallback. Runs against the REAL modules, with fake
// database/PayMongo dependencies — no network, no database, no mark_booking_paid:
//   node --experimental-strip-types --conditions=react-server scripts/verify/audit2-paymongo-webhook.mjs
import { createHmac } from 'node:crypto'
import { verifyWebhookSignature, WEBHOOK_TOLERANCE_SECONDS } from '../../src/lib/paymongo.ts'
import { handlePaymentPaid, checkIntentPaysBooking } from '../../src/lib/paymongo-webhook.ts'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS ${name}`) } else { fail++; console.log(`FAIL ${name} ${detail}`) }
}

const SECRET = 'whsk_test_local_only_not_a_real_secret'
const body = JSON.stringify({ data: { attributes: { type: 'payment.paid', data: { attributes: { payment_intent_id: 'pi_1', amount: 249000 } } } } })
const sign = (t, raw = body, secret = SECRET) => createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
const now = Date.now()
const nowS = Math.floor(now / 1000)

// ── Signature gate ──
{
  const t = nowS
  const r = verifyWebhookSignature(body, `t=${t},te=${sign(t)},li=`, SECRET, now)
  check('(b) fresh, correctly signed test-mode event passes', r.ok === true, JSON.stringify(r))
  const r2 = verifyWebhookSignature(body, `t=${t},te=,li=${sign(t)}`, SECRET, now)
  check('(b) fresh, correctly signed live-mode event passes', r2.ok === true, JSON.stringify(r2))
}
{
  const t = nowS - (WEBHOOK_TOLERANCE_SECONDS + 60)
  const r = verifyWebhookSignature(body, `t=${t},te=${sign(t)},li=`, SECRET, now)
  check('(a) correctly signed but stale event is rejected as stale', r.ok === false && r.reason === 'stale', JSON.stringify(r))
  const future = nowS + WEBHOOK_TOLERANCE_SECONDS + 60
  const rf = verifyWebhookSignature(body, `t=${future},te=${sign(future)},li=`, SECRET, now)
  check('(a) correctly signed event from the far future is rejected', rf.ok === false && rf.reason === 'stale', JSON.stringify(rf))
  const edge = nowS - (WEBHOOK_TOLERANCE_SECONDS - 5)
  check('within tolerance still passes', verifyWebhookSignature(body, `t=${edge},te=${sign(edge)}`, SECRET, now).ok === true)
}
{
  const t = nowS
  const forged = sign(t, body, 'whsk_attacker_guess')
  const r = verifyWebhookSignature(body, `t=${t},te=${forged},li=${forged}`, SECRET, now)
  check('(c) forged signature is rejected as invalid', r.ok === false && r.reason === 'invalid', JSON.stringify(r))
  const tampered = body.replace('249000', '100')
  const r2 = verifyWebhookSignature(tampered, `t=${t},te=${sign(t)}`, SECRET, now)
  check('(c) signature over a different body is rejected', r2.ok === false && r2.reason === 'invalid', JSON.stringify(r2))
  const old = nowS - 100000
  const r3 = verifyWebhookSignature(body, `t=${old},te=${forged}`, SECRET, now)
  check('(c) forged + stale reports invalid, not stale (signature checked first)', r3.ok === false && r3.reason === 'invalid', JSON.stringify(r3))
  check('missing header rejected', verifyWebhookSignature(body, null, SECRET, now).ok === false)
  check('non-numeric timestamp rejected', verifyWebhookSignature(body, `t=abc,te=${sign('abc')}`, SECRET, now).ok === false)
  check('short signature rejected', verifyWebhookSignature(body, `t=${t},te=ab`, SECRET, now).ok === false)
}

// ── Fallback decision logic ──
function fakeDeps({ byRef = null, byId = {}, intent, intentThrows = false }) {
  const calls = { markPaid: [], notify: [], alerts: [] }
  return {
    calls,
    deps: {
      findBookingByRef: async () => byRef,
      findBookingById: async (id) => byId[id] ?? null,
      getIntent: async () => { if (intentThrows) throw new Error('network down'); return intent },
      markPaid: async (bookingId, ref) => { calls.markPaid.push([bookingId, ref]); return { error: null } },
      notifyPaid: (id) => calls.notify.push(id),
      alert: (message, detail) => calls.alerts.push({ message, detail }),
    },
  }
}
const booking = { id: 'b-1', payment_status: 'unpaid', status: 'pending', total_amount: 2490, paymongo_ref: 'pi_2_current' }
function intentFor(over = {}) {
  const attributes = { status: 'succeeded', amount: 249000, currency: 'PHP', metadata: { booking_id: 'b-1' }, ...over }
  return { id: 'pi_1_stale', attributes }
}

{
  const { deps, calls } = fakeDeps({ byRef: booking, intent: intentFor() })
  const out = await handlePaymentPaid('pi_2_current', { amount: 249000 }, deps)
  check('ref match marks paid (unchanged path)', out === 'marked_paid' && calls.markPaid.length === 1, out)
}
{
  const { deps, calls } = fakeDeps({ byId: { 'b-1': booking }, intent: intentFor() })
  const out = await handlePaymentPaid('pi_1_stale', { amount: 249000, currency: 'PHP' }, deps)
  check('stale intent with matching amount is recovered via metadata', out === 'marked_paid_via_metadata', out)
  check('...and marks the metadata booking with the paid intent id', JSON.stringify(calls.markPaid) === JSON.stringify([['b-1', 'pi_1_stale']]))
}
{
  const { deps, calls } = fakeDeps({ byId: { 'b-1': booking }, intent: intentFor({ amount: 100 }) })
  const out = await handlePaymentPaid('pi_1_stale', { amount: 100 }, deps)
  check('(d) fallback REFUSES when intent amount disagrees with booking total', out === 'refused', out)
  check('(d) ...never calls mark_booking_paid', calls.markPaid.length === 0)
  check('(d) ...and alerts loudly', calls.alerts.length === 1 && /REFUSED/.test(calls.alerts[0].message))
}
{
  const { deps, calls } = fakeDeps({ byId: { 'b-1': booking }, intent: intentFor() })
  const out = await handlePaymentPaid('pi_1_stale', { amount: 100 }, deps)
  check('(d) fallback refuses when the event payment amount disagrees', out === 'refused' && calls.markPaid.length === 0, out)
}
{
  const { deps, calls } = fakeDeps({ byId: { 'b-1': booking }, intent: intentFor({ status: 'awaiting_next_action' }) })
  const out = await handlePaymentPaid('pi_1_stale', null, deps)
  check('fallback refuses a non-succeeded intent', out === 'refused' && calls.markPaid.length === 0, out)
}
{
  const { deps, calls } = fakeDeps({ byId: { 'b-1': booking }, intent: intentFor({ currency: 'USD' }) })
  const out = await handlePaymentPaid('pi_1_stale', null, deps)
  check('fallback refuses a non-PHP intent', out === 'refused' && calls.markPaid.length === 0, out)
}
{
  const paid = { ...booking, payment_status: 'paid' }
  const { deps, calls } = fakeDeps({ byId: { 'b-1': paid }, intent: intentFor() })
  const out = await handlePaymentPaid('pi_1_stale', { amount: 249000 }, deps)
  check('duplicate payment on an already-paid booking is refused and alerted', out === 'refused' && calls.markPaid.length === 0 && /DUPLICATE/.test(calls.alerts[0]?.message ?? ''), out)
}
{
  const { deps, calls } = fakeDeps({ intent: intentFor({ metadata: null }) })
  const out = await handlePaymentPaid('pi_orphan', null, deps)
  check('no ref and no metadata -> unmatched, logged loudly', out === 'unmatched' && calls.alerts.length === 1 && /UNMATCHED/.test(calls.alerts[0].message) && calls.alerts[0].detail.intentId === 'pi_orphan', out)
}
{
  const { deps, calls } = fakeDeps({ intent: intentFor({ metadata: { booking_id: 'b-missing' } }) })
  const out = await handlePaymentPaid('pi_orphan2', null, deps)
  check('metadata naming a non-existent booking -> unmatched, logged', out === 'unmatched' && calls.alerts.length === 1 && calls.markPaid.length === 0, out)
}
{
  const { deps, calls } = fakeDeps({ intentThrows: true })
  const out = await handlePaymentPaid('pi_x', null, deps)
  check('intent fetch failure -> retry (non-2xx), logged', out === 'retry' && calls.alerts.length === 1 && calls.markPaid.length === 0, out)
}
check('checkIntentPaysBooking rejects metadata naming another booking',
  checkIntentPaysBooking(intentFor({ metadata: { booking_id: 'b-other' } }), booking).ok === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
