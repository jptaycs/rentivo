// Setup / teardown for the host-side delivery-details browser check
// (distance-based delivery final review I1). Creates four probe bookings on one
// of the demo host's listings, by service role, and records the baseline so
// teardown can prove it is back where it started.
//
//   node --experimental-strip-types scripts/verify/host-delivery-details.mjs setup
//   node --experimental-strip-types scripts/verify/host-delivery-details.mjs teardown
import { admin, check, done } from './env.mjs'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STATE = join(tmpdir(), 'rentivo-host-delivery-details-state.json')
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_REF = 'RNT-A4DA55'
const HOST = 'a0000000-0000-4000-8000-0000000000ff'
const RENTER = 'a0000000-0000-4000-8000-0000000000fe'
const LISTING = '3e2f8e77-4e99-49c8-9c26-39ceb61b2520' // demo host's "PayMongo Test Lens (instant)"
const mode = process.argv[2] ?? 'setup'

const count = async (path) => (await admin(path)).body.length
async function baseline() {
  const forbidden = (await admin(`bookings?select=id,status,payment_status,updated_at&booking_ref=eq.${FORBIDDEN_REF}`)).body
  const fhost = (await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)).body
  return {
    hostBookings: await count(`bookings?select=id&host_id=eq.${HOST}`),
    allBookings: await count('bookings?select=id'),
    conversations: await count('conversations?select=id'),
    messages: await count('messages?select=id'),
    hostNotifications: await count(`notifications?select=id&user_id=eq.${HOST}`),
    renterNotifications: await count(`notifications?select=id&user_id=eq.${RENTER}`),
    rateLimitHits: await count(`rate_limit_hits?select=key&key=like.*${RENTER}*`),
    listing: (await admin(`listings?select=id,is_active,delivery_fee,delivery_fee_per_km,updated_at&id=eq.${LISTING}`)).body[0],
    forbidden: JSON.stringify({ forbidden, fhost }),
  }
}

if (mode === 'teardown') {
  if (!existsSync(STATE)) { console.log('nothing to tear down'); process.exit(0) }
  const st = JSON.parse(readFileSync(STATE, 'utf8'))
  for (const id of st.bookingIds) {
    await admin(`availability_blocks?booking_id=eq.${id}`, { method: 'DELETE' })
    await admin(`conversations?booking_id=eq.${id}`, { method: 'DELETE' }) // messages cascade
    await admin(`bookings?id=eq.${id}`, { method: 'DELETE' })
  }
  // Trigger-written notifications from these probe bookings (and nothing older).
  const since = encodeURIComponent(st.startedAt)
  await admin(`notifications?user_id=in.(${HOST},${RENTER})&created_at=gte.${since}`, { method: 'DELETE' })
  await admin(`rate_limit_hits?key=like.*${RENTER}*&hit_at=gte.${since}`, { method: 'DELETE' })
  const after = await baseline()
  for (const k of Object.keys(st.before)) {
    const a = JSON.stringify(after[k]), b = JSON.stringify(st.before[k])
    check(`restored: ${k}`, a === b, `before=${b} after=${a}`)
  }
  const left = (await admin(`bookings?select=id&id=in.(${st.bookingIds.join(',')})`)).body
  check('no probe booking remains', left.length === 0)
  unlinkSync(STATE)
  done()
}

const before = await baseline()
const startedAt = new Date(Date.now() - 1000).toISOString()
const common = {
  listing_id: LISTING, renter_id: RENTER, host_id: HOST,
  rental_fee: 2000, security_deposit: 0, service_fee: 100, protection_fee: 0,
  status: 'pending', payment_method: 'qrph',
}
const rows = [
  { key: 'paidPerKm', pickup_date: '2027-03-01', return_date: '2027-03-03', is_delivery: true,
    delivery_address: 'Unit 12B, 8 Paseo de Roxas\nLegaspi Village, Makati City',
    delivery_fee: 240, delivery_distance_km: 7, delivery_latitude: 14.5547, delivery_longitude: 121.0244,
    total_amount: 2340, payment_status: 'paid', paid_at: new Date().toISOString(), paymongo_ref: 'pi_probe_host_delivery' },
  { key: 'unpaidPerKm', pickup_date: '2027-03-05', return_date: '2027-03-07', is_delivery: true,
    delivery_address: '99 Unpaid Probe Street, Quezon City',
    delivery_fee: 300, delivery_distance_km: 10, delivery_latitude: 14.6760, delivery_longitude: 121.0437,
    total_amount: 2400, payment_status: 'unpaid' },
  { key: 'paidFlat', pickup_date: '2027-03-09', return_date: '2027-03-11', is_delivery: true,
    delivery_address: '5 Flat Fee Probe Road, Pasig City',
    delivery_fee: 350, total_amount: 2450, payment_status: 'paid', paid_at: new Date().toISOString(), paymongo_ref: 'pi_probe_host_flat' },
  { key: 'paidPickup', pickup_date: '2027-03-13', return_date: '2027-03-15', is_delivery: false,
    total_amount: 2100, payment_status: 'paid', paid_at: new Date().toISOString(), paymongo_ref: 'pi_probe_host_pickup' },
]
const out = {}
for (const { key, ...r } of rows) {
  const res = await admin('bookings', { method: 'POST', body: JSON.stringify({ ...common, ...r }) })
  if (res.status !== 201) throw new Error(`${key}: ${res.status} ${JSON.stringify(res.body)}`)
  out[key] = { id: res.body[0].id, ref: res.body[0].booking_ref }
}
writeFileSync(STATE, JSON.stringify({ before, startedAt, bookingIds: Object.values(out).map((o) => o.id), out }, null, 2))
console.log(JSON.stringify(out, null, 2))
