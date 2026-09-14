// Verifies migration 078 (distance-based delivery fee).
//
// Proves: the fee is computed server-side from the listing's PUBLIC approximate
// point (never the exact pin — that is what stops a renter trilaterating the
// host's private pickup location from the price steps); the quote and the
// charge agree; per-km is refused without a host-placed pin; no-delivery
// listings still refuse delivery; flat-fee behaviour is unchanged; coordinates
// never leak through the quote; the dead host_qr branch is gone; exactly one
// create_booking overload exists with its original grants.
//
// Every authorisation claim uses a REAL signed-in session on the anon key; the
// service role is used only for setup, independent re-reads and cleanup. Every
// refusal is paired with a CONTROL. Throwaway @example.com accounts only; the
// forbidden host and booking are only read, before and after.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/078-distance-based-delivery-fee.mjs
import { execFileSync } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, check, done } from './env.mjs'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '../../src/lib/listing-columns.ts'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const created = { users: [], listings: [] }

// Captured from the live database before 078 (information_schema.routine_privileges).
const EXPECTED_CREATE_BOOKING_GRANTS = ['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']

// Independent JS implementation of the fee rule — the oracle the database is
// checked against. Deliberately separate code (haversine via asin; Postgres
// uses the acos form), so a shared bug can't pass.
function haversineKm(fromLat, fromLng, toLat, toLng) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(toLat - fromLat)
  const dLng = toRad(toLng - fromLng)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
function expectedFee({ base, rate, fromLat, fromLng, toLat, toLng }) {
  const km = haversineKm(fromLat, fromLng, toLat, toLng)
  const roadKm = Math.ceil(km * 1.3)
  return { fee: base + roadKm * rate, roadKm, raw: km * 1.3 }
}

// ── helpers ──────────────────────────────────────────────────────────────
async function createUser(label) {
  const email = `probe-078-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  const s = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json())
  if (!s.access_token) throw new Error('sign-in failed ' + email)
  return { id: j.id, token: s.access_token }
}
async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const msg = (r) => JSON.stringify(r.body ?? '')
const ok = (r) => r.status >= 200 && r.status < 300
const raised = (r, text) => r.status === 400 && msg(r).includes(text)
const sql = (q) => JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).rows

const utcToday = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
const day = (n) => new Date(utcToday.getTime() + n * 86400000).toISOString().slice(0, 10)
const FROM = day(20)
const TO = day(22)

// Naga City. Deliberately NOT on the 3dp grid, so the exact pin and the public
// approx point differ (by ~60m) and check 1b can tell which one was used.
const PIN = { lat: 13.62144, lng: 123.19436 }

async function newListing(hostId, extra = {}) {
  const { status, body } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, title: `Probe 078 ${stamp}`, brand: 'Sony', model: 'A7 IV',
      category: 'mirrorless', condition: 'excellent', description: 'Probe listing for 078.',
      daily_price: 1000, security_deposit: 0, city: 'Naga City', province: 'Camarines Sur',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false, is_instant_book: false,
      latitude: PIN.lat, longitude: PIN.lng, location_is_exact: true,
      delivery_fee: 100, delivery_fee_per_km: 20, ...extra,
    }),
  })
  if (status !== 201) throw new Error('newListing: ' + JSON.stringify(body))
  created.listings.push(body[0].id)
  return body[0].id
}
const setListing = (id, patch) => admin(`listings?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
const readListing = async (id) =>
  (await admin(`listings?select=latitude,longitude,approx_latitude,approx_longitude,delivery_fee,delivery_fee_per_km,location_is_exact&id=eq.${id}`)).body[0]
const readBooking = async (id) => (await admin(`bookings?select=*&id=eq.${id}`)).body[0]
const book = (u, listingId, extra = {}) =>
  rpc(u.token, 'create_booking', {
    p_listing_id: listingId, p_pickup_date: FROM, p_return_date: TO, p_payment_method: 'qrph', ...extra,
  })
const deliver = (lat, lng) => ({ p_is_delivery: true, p_delivery_address: 'Probe St, Naga City', p_delivery_lat: lat, p_delivery_lng: lng })
// Destination `km` kilometres due east-north-east of the pin.
const offset = (km, bearingDeg = 60) => {
  const b = (bearingDeg * Math.PI) / 180
  return { lat: PIN.lat + (km * Math.cos(b)) / 111.32, lng: PIN.lng + (km * Math.sin(b)) / (111.32 * Math.cos((PIN.lat * Math.PI) / 180)) }
}

async function cleanup() {
  for (const u of created.users) {
    await admin(`messages?sender_id=eq.${u}`, { method: 'DELETE' })
    await admin(`bookings?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
  }
  for (const id of created.listings) {
    await admin(`availability_blocks?listing_id=eq.${id}`, { method: 'DELETE' })
    await admin(`rate_limit_hits?key=like.*${id}*`, { method: 'DELETE' })
    await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const u of created.users) {
    await admin(`rate_limit_hits?key=like.*${u}*`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, {
      method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  }
}
async function proveCleanup() {
  let leftovers = 0
  const detail = []
  for (const u of created.users) {
    for (const [t, q] of [
      ['bookings', `bookings?select=id&or=(renter_id.eq.${u},host_id.eq.${u})`],
      ['conversations', `conversations?select=id&or=(renter_id.eq.${u},host_id.eq.${u})`],
      ['notifications', `notifications?select=id&user_id=eq.${u}`],
      ['rate_limit_hits', `rate_limit_hits?select=key&key=like.*${u}*`],
      ['profiles', `profiles?select=id&id=eq.${u}`],
    ]) {
      const n = (await admin(q)).body.length
      if (n) { leftovers += n; detail.push(`${t}:${n}`) }
    }
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
    if (r.status !== 404) { leftovers++; detail.push(`auth:${r.status}`) }
  }
  for (const id of created.listings) {
    const n = (await admin(`listings?select=id&id=eq.${id}`)).body.length
    if (n) { leftovers += n; detail.push('listing') }
  }
  return { leftovers, detail }
}

const countOf = async (t) => (await admin(`${t}?select=id&limit=100000`)).body.length
const TABLES = ['bookings', 'conversations', 'messages', 'notifications', 'listings', 'profiles']
const before = {}
for (const t of TABLES) before[t] = await countOf(t)
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status,total_amount&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

try {
  // ── storefront: the new column in LISTING_COLUMNS must not empty an !inner embed ──
  {
    const select = `${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey!inner(${PROFILE_COLUMNS})`
    const res = await asUser(null, `listings?select=${encodeURIComponent(select)}&is_active=eq.true&is_draft=eq.false`)
    const { body: all } = await admin('listings?select=id,host:profiles!listings_host_id_fkey(suspended_at)&is_active=eq.true&is_draft=eq.false')
    const expected = all.filter((l) => !l.host?.suspended_at).length
    check('storefront !inner read (anon, LISTING_COLUMNS) returns every active listing',
      res.status === 200 && Array.isArray(res.body) && res.body.length === expected && expected > 0,
      `${res.status} got ${Array.isArray(res.body) ? res.body.length : msg(res).slice(0, 120)} expected ${expected}`)
  }

  // ── setup ──────────────────────────────────────────────────────────────
  const H = await createUser('host')
  await admin(`profiles?id=eq.${H.id}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 078 Host' }) })
  const R1 = await createUser('r1')
  const R2 = await createUser('r2')
  const STRANGER = await createUser('stranger')
  const L = await newListing(H.id)
  const lst = await readListing(L)
  const approx = { lat: Number(lst.approx_latitude), lng: Number(lst.approx_longitude) }
  check('setup: probe listing has a host-placed pin off the 3dp grid',
    lst.location_is_exact === true && (approx.lat !== PIN.lat || approx.lng !== PIN.lng),
    `exact ${lst.latitude},${lst.longitude} approx ${approx.lat},${approx.lng}`)

  // ── 1. quote equals charge equals oracle (approx origin) ──────────────────
  const dest1 = offset(5)
  const oracle1 = expectedFee({ base: 100, rate: 20, fromLat: approx.lat, fromLng: approx.lng, toLat: dest1.lat, toLng: dest1.lng })
  const q1 = await rpc(R1.token, 'quote_delivery_fee', { p_listing_id: L, p_delivery_lat: dest1.lat, p_delivery_lng: dest1.lng })
  const quote1 = Array.isArray(q1.body) ? q1.body[0] : null
  const b1 = await book(R1, L, deliver(dest1.lat, dest1.lng))
  check('1. quote succeeds', ok(q1) && quote1, `${q1.status} ${msg(q1).slice(0, 160)}`)
  check('1. create_booking with a delivery pin succeeds', ok(b1), `${b1.status} ${msg(b1).slice(0, 160)}`)
  const booking1 = ok(b1) ? await readBooking(b1.body.id) : null
  check('1. quote.fee === booking.delivery_fee === oracle.fee',
    quote1?.fee === oracle1.fee && booking1?.delivery_fee === oracle1.fee,
    `quote ${quote1?.fee} booking ${booking1?.delivery_fee} oracle ${oracle1.fee} (${oracle1.roadKm} road km)`)
  check('1. quote.road_km and booking.delivery_distance_km equal oracle road km',
    quote1?.road_km === oracle1.roadKm && Number(booking1?.delivery_distance_km) === oracle1.roadKm,
    `quote ${quote1?.road_km} booking ${booking1?.delivery_distance_km} oracle ${oracle1.roadKm}`)
  check('1. per-km booking stores the delivery pin',
    Number(booking1?.delivery_latitude).toFixed(6) === dest1.lat.toFixed(6) &&
    Number(booking1?.delivery_longitude).toFixed(6) === dest1.lng.toFixed(6),
    `${booking1?.delivery_latitude},${booking1?.delivery_longitude}`)

  // ── 1b. measured from the approx point, not the exact pin ─────────────────
  {
    let found = null
    for (let km = 3; km < 12 && !found; km += 0.013) {
      const d = offset(km, 200)
      const a = expectedFee({ base: 100, rate: 20, fromLat: approx.lat, fromLng: approx.lng, toLat: d.lat, toLng: d.lng })
      const e = expectedFee({ base: 100, rate: 20, fromLat: PIN.lat, fromLng: PIN.lng, toLat: d.lat, toLng: d.lng })
      const safe = (x) => Math.abs(x.raw - Math.round(x.raw)) > 0.01 // keep clear of float boundaries
      if (a.roadKm !== e.roadKm && safe(a) && safe(e)) found = { d, a, e }
    }
    check('1b. found a destination where exact-origin and approx-origin km differ', Boolean(found))
    if (found) {
      const q = await rpc(R1.token, 'quote_delivery_fee', { p_listing_id: L, p_delivery_lat: found.d.lat, p_delivery_lng: found.d.lng })
      const b = await book(R1, L, deliver(found.d.lat, found.d.lng))
      const bk = ok(b) ? await readBooking(b.body.id) : null
      check('1b. quote and charge match the APPROX-origin oracle, not the exact-origin one',
        q.body?.[0]?.fee === found.a.fee && bk?.delivery_fee === found.a.fee && bk?.delivery_fee !== found.e.fee,
        `quote ${q.body?.[0]?.fee} charged ${bk?.delivery_fee} approx-oracle ${found.a.fee} exact-oracle ${found.e.fee}`)
    }
  }

  // ── 2. quote leaks no coordinates ─────────────────────────────────────────
  check('2. quote response keys are exactly fee and road_km',
    quote1 && JSON.stringify(Object.keys(quote1).sort()) === JSON.stringify(['fee', 'road_km']),
    JSON.stringify(quote1))

  // ── 3. service fee unchanged by delivery ─────────────────────────────────
  check('3. service_fee is 5% of the rental alone',
    booking1 && booking1.service_fee === Math.round(booking1.rental_fee * 0.05),
    `rental ${booking1?.rental_fee} service ${booking1?.service_fee}`)
  check('3. total = rental + service + delivery',
    booking1 && booking1.total_amount === booking1.rental_fee + booking1.service_fee + booking1.delivery_fee,
    `total ${booking1?.total_amount}`)

  // ── 4. no host-placed pin + per-km refused; control: per-km 0 charges base ──
  await setListing(L, { location_is_exact: false })
  {
    const d = offset(5)
    const r = await book(R1, L, deliver(d.lat, d.lng))
    check('4. per-km without an exact pickup point is refused', raised(r, 'exact pickup point'), `${r.status} ${msg(r).slice(0, 160)}`)
    const rq = await rpc(R1.token, 'quote_delivery_fee', { p_listing_id: L, p_delivery_lat: d.lat, p_delivery_lng: d.lng })
    check('4. quote likewise refuses per-km without an exact pickup point', raised(rq, 'exact pickup point'), `${rq.status} ${msg(rq).slice(0, 120)}`)
    await setListing(L, { delivery_fee_per_km: 0 })
    const c = await book(R1, L, deliver(d.lat, d.lng))
    const cb = ok(c) ? await readBooking(c.body.id) : null
    check('4. CONTROL: same call with per-km 0 succeeds and charges exactly the base',
      ok(c) && cb?.delivery_fee === 100, `${c.status} fee ${cb?.delivery_fee} ${msg(c).slice(0, 120)}`)
    check('4. flat-fee delivery stores no distance and no coordinates',
      cb && cb.delivery_distance_km === null && cb.delivery_latitude === null && cb.delivery_longitude === null,
      `${cb?.delivery_distance_km} ${cb?.delivery_latitude} ${cb?.delivery_longitude}`)
  }
  await setListing(L, { location_is_exact: true, delivery_fee_per_km: 20 })

  // ── 5. missing destination refused; control with coordinates ──────────────
  {
    const r = await book(R1, L, { p_is_delivery: true, p_delivery_address: 'Probe St, Naga City' })
    check('5. per-km delivery with no destination is refused', raised(r, 'delivery location is required'), `${r.status} ${msg(r).slice(0, 160)}`)
    const d = offset(2)
    const c = await book(R2, L, deliver(d.lat, d.lng))
    check('5. CONTROL: same call with coordinates succeeds', ok(c), `${c.status} ${msg(c).slice(0, 120)}`)
  }

  // ── 6. out-of-range coordinates refused ───────────────────────────────────
  {
    const r = await book(R2, L, deliver(200, PIN.lng))
    check('6. p_delivery_lat = 200 is refused', raised(r, 'not valid'), `${r.status} ${msg(r).slice(0, 160)}`)
    const rq = await rpc(R2.token, 'quote_delivery_fee', { p_listing_id: L, p_delivery_lat: 200, p_delivery_lng: PIN.lng })
    check('6. quote refuses p_delivery_lat = 200', raised(rq, 'not valid'), `${rq.status} ${msg(rq).slice(0, 120)}`)
  }

  // ── 7. no delivery offered still refused; control: pickup succeeds ────────
  await setListing(L, { delivery_fee: null })
  {
    const d = offset(3)
    const r = await book(R2, L, deliver(d.lat, d.lng))
    check('7. delivery on a no-delivery listing is refused', raised(r, 'This host does not offer delivery.'), `${r.status} ${msg(r).slice(0, 160)}`)
    const rq = await rpc(R2.token, 'quote_delivery_fee', { p_listing_id: L, p_delivery_lat: d.lat, p_delivery_lng: d.lng })
    check('7. quote on a no-delivery listing is refused', raised(rq, 'This host does not offer delivery.'), `${rq.status} ${msg(rq).slice(0, 120)}`)
    const c = await book(R2, L)
    check('7. CONTROL: pickup on the same listing succeeds', ok(c), `${c.status} ${msg(c).slice(0, 120)}`)
  }
  await setListing(L, { delivery_fee: 100 })

  // ── 8. pickup ignores coordinates ─────────────────────────────────────────
  {
    const d = offset(4)
    const r = await book(R2, L, { p_is_delivery: false, p_delivery_lat: d.lat, p_delivery_lng: d.lng })
    const bk = ok(r) ? await readBooking(r.body.id) : null
    check('8. pickup with coordinates supplied: fee 0, no distance, no coordinates',
      bk && bk.delivery_fee === 0 && bk.delivery_distance_km === null && bk.delivery_latitude === null && bk.delivery_longitude === null,
      `${r.status} ${JSON.stringify(bk && { f: bk.delivery_fee, d: bk.delivery_distance_km, la: bk.delivery_latitude, lo: bk.delivery_longitude })}`)
  }

  // ── 9. client cannot forge the fee afterwards ─────────────────────────────
  if (booking1) {
    const r = await asUser(R1.token, `bookings?id=eq.${booking1.id}`, { method: 'PATCH', body: JSON.stringify({ delivery_fee: 1 }) })
    const after = await readBooking(booking1.id)
    check('9. renter PATCH of delivery_fee is permission denied and unchanged',
      msg(r).includes('permission denied for table bookings') && after.delivery_fee === booking1.delivery_fee,
      `${r.status} ${msg(r).slice(0, 120)} fee ${after.delivery_fee}`)
    for (const col of ['delivery_distance_km', 'delivery_latitude']) {
      const r2 = await asUser(R1.token, `bookings?id=eq.${booking1.id}`, { method: 'PATCH', body: JSON.stringify({ [col]: 1 }) })
      check(`9. renter PATCH of ${col} is permission denied`, msg(r2).includes('permission denied for table bookings'), `${r2.status} ${msg(r2).slice(0, 120)}`)
    }
  }

  // ── 10. per-km rate: owner may set it; anon and a stranger change nothing ──
  {
    const own = await asUser(H.token, `listings?id=eq.${L}`, { method: 'PATCH', body: JSON.stringify({ delivery_fee_per_km: 30 }), headers: { Prefer: 'return=minimal' } })
    const afterOwn = await readListing(L)
    check('10. host PATCH of own delivery_fee_per_km succeeds', ok(own) && afterOwn.delivery_fee_per_km === 30, `${own.status} ${msg(own).slice(0, 120)} now ${afterOwn.delivery_fee_per_km}`)
    const anon = await asUser(null, `listings?id=eq.${L}`, { method: 'PATCH', body: JSON.stringify({ delivery_fee_per_km: 999 }), headers: { Prefer: 'return=minimal' } })
    const afterAnon = await readListing(L)
    check('10. anon PATCH changes nothing', afterAnon.delivery_fee_per_km === 30, `${anon.status} ${msg(anon).slice(0, 120)} now ${afterAnon.delivery_fee_per_km}`)
    const str = await asUser(STRANGER.token, `listings?id=eq.${L}`, { method: 'PATCH', body: JSON.stringify({ delivery_fee_per_km: 999 }), headers: { Prefer: 'return=minimal' } })
    const afterStr = await readListing(L)
    check('10. a different signed-in user PATCH changes nothing', afterStr.delivery_fee_per_km === 30, `${str.status} ${msg(str).slice(0, 120)} now ${afterStr.delivery_fee_per_km}`)
    const read = await asUser(null, `listings?select=delivery_fee_per_km&id=eq.${L}`)
    check('10. anon can read delivery_fee_per_km', ok(read) && read.body?.[0]?.delivery_fee_per_km === 30, `${read.status} ${msg(read).slice(0, 80)}`)
  }

  // ── 11. quote is authenticated-only ───────────────────────────────────────
  {
    const r = await rpc(null, 'quote_delivery_fee', { p_listing_id: L, p_delivery_lat: dest1.lat, p_delivery_lng: dest1.lng })
    check('11. anon quote_delivery_fee is refused (401)', r.status === 401, `${r.status} ${msg(r).slice(0, 120)}`)
    const f = await rpc(R1.token, 'delivery_fee_for', { p_base: 1, p_rate: 1, p_location_is_exact: true, p_from_lat: 1, p_from_lng: 1, p_to_lat: 1, p_to_lng: 1 })
    check('11. delivery_fee_for is not client-callable', f.status >= 400 && msg(f).includes('permission denied'), `${f.status} ${msg(f).slice(0, 120)}`)
  }

  // ── 12. dead host_qr branch gone ──────────────────────────────────────────
  {
    const r = await book(R2, L, { p_payment_method: 'host_qr' })
    check('12. host_qr refusal carries the trigger message naming QR Ph', r.status >= 400 && msg(r).includes('QR Ph'), `${r.status} ${msg(r).slice(0, 160)}`)
    check('12. and is not an undefined-column error', !msg(r).includes('42703') && !msg(r).includes('qr_payment_url'), msg(r).slice(0, 160))
  }

  // ── 13/14. one overload, grants restored ──────────────────────────────────
  {
    const n = sql("select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='create_booking'")
    check('13. exactly one create_booking overload', n[0].n === 1, `count ${n[0].n}`)
    const g = sql("select grantee, privilege_type from information_schema.routine_privileges where routine_schema='public' and routine_name='create_booking' order by grantee")
    const got = g.map((x) => `${x.grantee}:${x.privilege_type}`).sort()
    check('14. create_booking grants equal the captured ones', JSON.stringify(got) === JSON.stringify(EXPECTED_CREATE_BOOKING_GRANTS), got.join(', '))
    const qg = sql("select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='quote_delivery_fee' order by grantee")
    check('14. quote_delivery_fee is not granted to anon or PUBLIC', !qg.some((x) => ['anon', 'PUBLIC'].includes(x.grantee)), qg.map((x) => x.grantee).join(', '))
    const fg = sql("select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='delivery_fee_for' order by grantee")
    check('14. delivery_fee_for is not granted to anon, authenticated or PUBLIC', !fg.some((x) => ['anon', 'authenticated', 'PUBLIC'].includes(x.grantee)), fg.map((x) => x.grantee).join(', '))
  }
} catch (e) {
  check('script ran without throwing', false, String(e?.stack ?? e))
} finally {
  await cleanup()
  const { leftovers, detail } = await proveCleanup()
  check('cleanup: every probe booking, notification, conversation, rate_limit_hits row, listing and user is gone', leftovers === 0, detail.join(', '))
  for (const t of TABLES) {
    const n = await countOf(t)
    check(`cleanup: ${t} count back at baseline`, n === before[t], `${before[t]} -> ${n}`)
  }
  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status,total_amount&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('forbidden host untouched', JSON.stringify(fHostAfter) === JSON.stringify(fHostBefore))
  check('forbidden booking untouched', JSON.stringify(fBookingAfter) === JSON.stringify(fBookingBefore))
  done()
}
