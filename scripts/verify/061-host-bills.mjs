// Verifies migration 061 (host commission billing ledger) against the hosted
// database. Real sessions for every authorisation claim; admin only for
// setup, independent re-reads and cleanup. Throwaway accounts only.
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }
const rpc = async (tok, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: tok === SECRET ? SECRET : ANON, Authorization: `Bearer ${tok ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const denied = (r) => r.status === 401 || r.status === 403 || /permission denied/.test(JSON.stringify(r.body))

// ── throwaway accounts (auth admin API) ──
async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json(); if (!j.id) throw new Error('createUser: ' + JSON.stringify(j)); return j.id
}
async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
}

const stamp = Date.now()
const hostEmail = `probe-bill-host-${stamp}@example.com`, renterEmail = `probe-bill-renter-${stamp}@example.com`
const baseline = async () => ({
  bills: (await admin('host_bills?select=id')).body.length,
  items: (await admin('host_bill_items?select=id')).body.length,
  bookings: (await admin('bookings?select=id')).body.length,
  notifications: (await admin('notifications?select=id')).body.length,
})
const before = await baseline()
const hostId = await createUser(hostEmail), renterId = await createUser(renterEmail)
let listingId = null
const bookingIds = []
try {
  // handle_new_user created profiles; make the host a verified host with a QR so host_qr is allowed.
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Bill Host', qr_payment_url: `${hostId}/probe.png`, qr_payment_label: 'GCash — Probe' }) })
  await admin(`profiles?id=eq.${renterId}`, { method: 'PATCH', body: JSON.stringify({ full_name: 'Probe Bill Renter' }) })
  const { body: [listing] } = await admin('listings', { method: 'POST', body: JSON.stringify({
    host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'B1', title: 'Probe billing listing', description: 'probe', condition: 'good',
    daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila', is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
  }) })
  listingId = listing.id
  const hostTok = await signIn(hostEmail, 'ProbeRentivo1'), renterTok = await signIn(renterEmail, 'ProbeRentivo1')

  // Four host_qr bookings, distinct date ranges so availability never collides.
  const mk = async (from, to) => {
    const r = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: from, p_return_date: to, p_is_delivery: false, p_delivery_address: null, p_payment_method: 'host_qr', p_promo_code: null })
    if (r.status !== 200) throw new Error('create_booking: ' + JSON.stringify(r.body))
    bookingIds.push(r.body.id); return r.body
  }
  const bInPeriod = await mk('2027-01-10', '2027-01-12')   // paid inside the probe period
  const bLate = await mk('2027-02-10', '2027-02-12')       // paid after the probe period
  const bCancelled = await mk('2027-03-10', '2027-03-12')  // paid, then cancelled
  const bPrePolicy = await mk('2027-04-10', '2027-04-12')  // paid before POLICY_START
  for (const b of [bInPeriod, bLate, bCancelled, bPrePolicy]) {
    const r = await rpc(hostTok, 'confirm_host_qr_payment', { p_booking_id: b.id })
    if (r.status !== 200) throw new Error('confirm_host_qr_payment: ' + JSON.stringify(r.body))
  }
  // Probe period: 2030-01 (far future so no real booking can ever collide).
  const PERIOD = '2030-01-01'
  await admin(`bookings?id=eq.${bInPeriod.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2030-01-15T10:00:00+08:00' }) })
  await admin(`bookings?id=eq.${bLate.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2030-02-03T10:00:00+08:00' }) })
  await admin(`bookings?id=eq.${bCancelled.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2030-01-20T10:00:00+08:00', status: 'cancelled' }) })
  await admin(`bookings?id=eq.${bPrePolicy.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2026-09-01T10:00:00+08:00' }) })
  const feeOf = async (id) => (await admin(`bookings?select=service_fee&id=eq.${id}`)).body[0].service_fee

  const badPeriod = await rpc(SECRET, 'generate_host_bills', { p_period: '2030-01-15' })
  check('generate_host_bills rejects a non-month-start period', badPeriod.status >= 400 && /first day/i.test(badPeriod.body?.message ?? ''), `${badPeriod.status} ${JSON.stringify(badPeriod.body)}`)

  // ── generate: once, then again ──
  const g1 = await rpc(SECRET, 'generate_host_bills', { p_period: PERIOD })
  check('generate #1 -> 200 with one bill', g1.status === 200 && Array.isArray(g1.body) && g1.body.length === 1, `${g1.status} ${JSON.stringify(g1.body).slice(0, 120)}`)
  const bill = g1.body[0]
  check('bill belongs to the probe host, period, status issued', bill?.host_id === hostId && bill?.period === PERIOD && bill?.status === 'issued')
  check('bill amount = in-period booking service_fee', bill?.amount === await feeOf(bInPeriod.id), `${bill?.amount}`)
  check('due_at ≈ issued_at + 14 days', Math.abs(new Date(bill.due_at) - new Date(bill.issued_at) - 14 * 864e5) < 60e3)
  const { body: items1 } = await admin(`host_bill_items?select=booking_id,amount&bill_id=eq.${bill.id}`)
  check('exactly one item, the in-period booking', items1.length === 1 && items1[0].booking_id === bInPeriod.id)
  const g2 = await rpc(SECRET, 'generate_host_bills', { p_period: PERIOD })
  check('generate #2 is a no-op (returns zero bills)', g2.status === 200 && g2.body.length === 0, `${JSON.stringify(g2.body).slice(0, 80)}`)
  const { body: billsNow } = await admin(`host_bills?select=id&host_id=eq.${hostId}`)
  check('still exactly one bill for the host', billsNow.length === 1)

  // ── next period picks up the late-paid booking, never re-bills the first ──
  const g3 = await rpc(SECRET, 'generate_host_bills', { p_period: '2030-02-01' })
  check('next period -> one new bill', g3.status === 200 && g3.body.length === 1)
  const { body: items2 } = await admin(`host_bill_items?select=booking_id&bill_id=eq.${g3.body[0].id}`)
  check('next bill holds only the late-paid booking', items2.length === 1 && items2[0].booking_id === bLate.id)
  const { body: allItems } = await admin(`host_bill_items?select=booking_id&booking_id=in.(${bookingIds.join(',')})`)
  check('cancelled and pre-policy bookings never itemized', !allItems.some((i) => i.booking_id === bCancelled.id || i.booking_id === bPrePolicy.id))

  // ── RLS / grants ──
  const own = await asUser(hostTok, `host_bills?select=id,amount,items:host_bill_items(booking_id,amount)&order=period.desc`)
  check('host reads own bills with items', own.status === 200 && own.body.length === 2 && own.body[0].items.length === 1)
  const other = await asUser(renterTok, `host_bills?select=id`)
  check('renter reads zero bills', other.status === 200 && other.body.length === 0)
  const otherItems = await asUser(renterTok, `host_bill_items?select=id`)
  check('renter reads zero items', otherItems.status === 200 && otherItems.body.length === 0)
  const anonBills = await asUser(null, `host_bills?select=id`)
  check('anon reads zero rows from host_bills (or denied)', (anonBills.status === 200 && anonBills.body.length === 0) || denied(anonBills), `${anonBills.status}`)
  const anonItems = await asUser(null, `host_bill_items?select=id`)
  check('anon reads zero rows from host_bill_items (or denied)', (anonItems.status === 200 && anonItems.body.length === 0) || denied(anonItems), `${anonItems.status}`)
  const ins = await asUser(hostTok, 'host_bills', { method: 'POST', body: JSON.stringify({ host_id: hostId, period: '2031-01-01', amount: 1, due_at: new Date().toISOString() }) })
  check('host cannot insert a bill (privilege)', denied(ins), `${ins.status}`)
  const upd = await asUser(hostTok, `host_bills?id=eq.${bill.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) })
  const { body: [afterUpd] } = await admin(`host_bills?select=status&id=eq.${bill.id}`)
  check('host cannot mark own bill paid (privilege)', denied(upd) && afterUpd.status === 'issued', `${upd.status} ${afterUpd.status}`)
  const del = await asUser(hostTok, `host_bill_items?bill_id=eq.${bill.id}`, { method: 'DELETE' })
  const { body: itemsAfterDel } = await admin(`host_bill_items?select=id&bill_id=eq.${bill.id}`)
  check('host cannot delete items (privilege)', denied(del) && itemsAfterDel.length === 1, `${del.status}`)
  const rpcAsHost = await rpc(hostTok, 'generate_host_bills', { p_period: PERIOD })
  check('generate_host_bills denied to authenticated', denied(rpcAsHost), `${rpcAsHost.status}`)
  const markAsHost = await rpc(hostTok, 'mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: 'pi_x' })
  check('mark_host_bill_paid denied to authenticated', denied(markAsHost), `${markAsHost.status}`)
  const voidAsHost = await rpc(hostTok, 'void_host_bill', { p_bill_id: bill.id, p_reason: 'nope' })
  check('void_host_bill denied to authenticated', denied(voidAsHost), `${voidAsHost.status}`)

  // ── delinquency + enforcement trigger ──
  const d0 = await rpc(null, 'is_host_billing_delinquent', { p_host_id: hostId })
  check('anon can call is_host_billing_delinquent; false within grace', d0.status === 200 && d0.body === false, `${d0.status} ${d0.body}`)
  await admin(`host_bills?id=eq.${bill.id}`, { method: 'PATCH', body: JSON.stringify({ due_at: '2026-01-01T00:00:00Z' }) })
  const d1 = await rpc(null, 'is_host_billing_delinquent', { p_host_id: hostId })
  check('true once a bill is past due', d1.body === true)
  const blocked = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: '2027-05-10', p_return_date: '2027-05-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'host_qr', p_promo_code: null })
  check('host_qr booking refused for a delinquent host', blocked.status >= 400 && /direct QR/.test(blocked.body?.message ?? ''), `${blocked.status} ${blocked.body?.message}`)
  const ctrl = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: '2027-05-10', p_return_date: '2027-05-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'qrph', p_promo_code: null })
  check('CONTROL: qrph booking for the same host still allowed', ctrl.status === 200 && ctrl.body?.id, `${ctrl.status}`)
  if (ctrl.body?.id) bookingIds.push(ctrl.body.id)

  // ── mark paid (idempotent) releases enforcement ──
  const p1 = await rpc(SECRET, 'mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: 'pi_probe_061' })
  check('mark_host_bill_paid -> paid with ref', p1.status === 200 && p1.body?.status === 'paid' && p1.body?.paymongo_ref === 'pi_probe_061' && p1.body?.paid_at)
  const p2 = await rpc(SECRET, 'mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: 'pi_other' })
  check('second mark_host_bill_paid is a no-op (same paid_at, ref unchanged)', p2.body?.paid_at === p1.body?.paid_at && p2.body?.paymongo_ref === 'pi_probe_061')
  const d2 = await rpc(null, 'is_host_billing_delinquent', { p_host_id: hostId })
  check('delinquency cleared after payment', d2.body === false)
  const allowed = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: '2027-06-10', p_return_date: '2027-06-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'host_qr', p_promo_code: null })
  check('host_qr booking allowed again after payment', allowed.status === 200, `${allowed.status} ${allowed.body?.message ?? ''}`)
  if (allowed.body?.id) bookingIds.push(allowed.body.id)

  // ── void: two modes (fix round 1, finding 2) ──
  const bill2 = g3.body[0]
  const vNoReason = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2.id, p_reason: '  ' })
  check('void without a reason raises', vNoReason.status >= 400 && /reason/i.test(vNoReason.body?.message ?? ''), `${vNoReason.status} ${vNoReason.body?.message}`)

  // Correction (p_rebill defaults true): releases the items.
  const v1 = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2.id, p_reason: 'probe void' })
  check('correction-void -> status void with reason', v1.status === 200 && v1.body?.status === 'void' && v1.body?.void_reason === 'probe void')
  const { body: itemsAfterVoid } = await admin(`host_bill_items?select=id&bill_id=eq.${bill2.id}`)
  check('correction-void released the items', itemsAfterVoid.length === 0)

  // The voided bill's (host_id, period) slot is free — a rerun of the SAME
  // period rebills the released booking rather than waiting for the next one.
  const g3b = await rpc(SECRET, 'generate_host_bills', { p_period: '2030-02-01' })
  check('same-period rerun after correction-void creates one new bill', g3b.status === 200 && g3b.body.length === 1, `${g3b.status} ${JSON.stringify(g3b.body).slice(0, 100)}`)
  const bill2b = g3b.body[0]
  const { body: items2b } = await admin(`host_bill_items?select=booking_id&bill_id=eq.${bill2b.id}`)
  check('rebilled bill holds the late-paid booking again', items2b.length === 1 && items2b[0].booking_id === bLate.id)
  const { body: feb2030Rows } = await admin(`host_bills?select=id,status&host_id=eq.${hostId}&period=eq.2030-02-01`)
  check('host now has two rows for 2030-02 (one void, one issued)', feb2030Rows.length === 2 && feb2030Rows.some((r) => r.status === 'void') && feb2030Rows.some((r) => r.status === 'issued'))

  const markVoid = await rpc(SECRET, 'mark_host_bill_paid', { p_bill_id: bill2.id, p_paymongo_ref: 'pi_should_fail' })
  check('mark_host_bill_paid on a void bill raises', markVoid.status >= 400 && /void/i.test(markVoid.body?.message ?? ''), `${markVoid.status} ${markVoid.body?.message}`)

  // Waiver (p_rebill: false): the host paid Rentivo outside the app, so the
  // items stay attached — the booking must never be re-billed again.
  const vWaive = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2b.id, p_reason: 'waived — paid outside app', p_rebill: false })
  check('waiver void -> status void', vWaive.status === 200 && vWaive.body?.status === 'void' && vWaive.body?.void_reason === 'waived — paid outside app')
  const { body: itemsAfterWaive } = await admin(`host_bill_items?select=id&bill_id=eq.${bill2b.id}`)
  check('waiver void keeps the items attached', itemsAfterWaive.length === 1)
  const g4 = await rpc(SECRET, 'generate_host_bills', { p_period: '2030-03-01' })
  check('rerun never re-bills a waived booking', g4.status === 200 && !g4.body.some((b) => b.host_id === hostId), `${g4.status} ${JSON.stringify(g4.body).slice(0, 100)}`)

  const vPaid = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill.id, p_reason: 'should fail' })
  check('voiding a paid bill raises', vPaid.status >= 400 && /paid bill/i.test(vPaid.body?.message ?? ''), `${vPaid.status} ${vPaid.body?.message}`)
  const vAgain = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2.id, p_reason: 'again' })
  check('voiding a void bill is a no-op with the original reason', vAgain.status === 200 && vAgain.body?.void_reason === 'probe void')
} finally {
  // Bills before bookings: host_bill_items.booking_id has NO cascade, so
  // deleting host_bills first (cascading its items) avoids an FK violation.
  await admin(`host_bills?host_id=eq.${hostId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${hostId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${renterId}`, { method: 'DELETE' })
  if (bookingIds.length) await admin(`bookings?id=in.(${bookingIds.join(',')})`, { method: 'DELETE' })
  if (listingId) await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  await admin(`profiles?id=in.(${hostId},${renterId})`, { method: 'DELETE' })
  await deleteUser(hostId); await deleteUser(renterId)
  const after = await baseline()
  for (const k of Object.keys(before)) check(`baseline ${k} ${before[k]} -> ${after[k]}`, before[k] === after[k])
  const { body: forb } = await admin(`profiles?select=id&id=eq.${FORBIDDEN_HOST}`)
  check('forbidden host untouched', forb.length === 1)
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
