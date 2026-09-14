// Verifies migration 079 and its app-side companion.
//
//  1. Storage refuses an object key with a `..` segment, per bucket (control:
//     the same key without it is accepted). Keys are sent with %2F-encoded
//     slashes, because fetch/URL would otherwise NORMALISE `a/../x` away before
//     it ever reached Storage — and the stored name is re-read to prove the
//     encoding arrives literally.
//  2. handle_new_user nulls an untrusted avatar_url (control: a Google avatar
//     URL and this project's storage URL are kept).
//  3. A table created as role postgres in public inherits no anon/authenticated
//     privileges (control: service_role still does, and an explicit grant works).
//  4. quote_delivery_fee trips at exactly 120 quotes per 10 minutes (control:
//     every earlier quote succeeds, and the hit count is what the limiter wrote).
//  5. Magic-byte check: the REAL src/lib/image-bytes.ts module refuses HTML
//     labelled image/png and accepts real JPEG/PNG/WebP/AVIF headers; and
//     Storage itself is shown to ACCEPT HTML under an image/png label — the gap
//     the client check exists for. (The in-app rejection is proven in a browser,
//     not here.)
//
// Real signed-in sessions for every authorisation claim; service role only for
// setup, re-reads and cleanup. Throwaway @example.com accounts, deleted after.
// Users are created with the GoTrue admin API carrying user_metadata — the same
// raw_user_meta_data the public signup endpoint writes, without sending a
// confirmation email to a non-existent inbox.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/079-hardening-and-delivery-followups.mjs
import { execFileSync } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'
import { checkImageFile, sniffImageBytes } from '../../src/lib/image-bytes.ts'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const created = { users: [], listings: [], objects: [], tables: [] }
const sql = (q) => JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).rows
const msg = (r) => JSON.stringify(r.body ?? '')
const ok = (r) => r.status >= 200 && r.status < 300

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const HTML = Buffer.from('<!doctype html><html><body><form action="https://evil.example.com">Sign in to Rentivo</form></body></html>')

async function createUser(label, metadata = {}) {
  const email = `probe-079-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: metadata }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  const s = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json())
  if (!s.access_token) throw new Error('sign-in failed ' + email)
  return { id: j.id, token: s.access_token }
}
async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
/** Upload as a user. `key` slashes are %2F-encoded so `..` survives URL parsing. */
async function upload(token, bucket, key, bytes, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${key.split('/').map(encodeURIComponent).join('%2F')}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: bytes,
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const objectRow = (bucket, name) =>
  sql(`select name, metadata->>'mimetype' as mimetype from storage.objects where bucket_id = '${bucket}' and name = '${name.replace(/'/g, "''")}'`)[0]

async function cleanup() {
  for (const { bucket, name } of created.objects) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [name] }),
    })
  }
  for (const t of created.tables) {
    try { sql(`drop table if exists public.${t}`) } catch { /* reported by proveCleanup */ }
  }
  for (const id of created.listings) await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`bookings?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`rate_limit_hits?key=like.*${u}*`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
  }
}
async function proveCleanup() {
  const detail = []
  for (const u of created.users) {
    for (const [t, q] of [
      ['profiles', `profiles?select=id&id=eq.${u}`],
      ['notifications', `notifications?select=id&user_id=eq.${u}`],
      ['rate_limit_hits', `rate_limit_hits?select=key&key=like.*${u}*`],
    ]) {
      const n = (await admin(q)).body.length
      if (n) detail.push(`${t}:${n}`)
    }
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
    if (r.status !== 404) detail.push(`auth:${r.status}`)
    const objs = sql(`select count(*)::int as n from storage.objects where name like '${u}/%'`)[0].n
    if (objs) detail.push(`storage:${objs}`)
  }
  for (const id of created.listings) if ((await admin(`listings?select=id&id=eq.${id}`)).body.length) detail.push('listing')
  for (const t of created.tables) if (sql(`select to_regclass('public.${t}') is not null as e`)[0].e) detail.push(`table:${t}`)
  return detail
}

const countOf = async (t) => (await admin(`${t}?select=id&limit=100000`)).body.length
const TABLES = ['bookings', 'listings', 'profiles', 'notifications']
const before = {}
for (const t of TABLES) before[t] = await countOf(t)
const hitsBefore = sql('select count(*)::int as n from public.rate_limit_hits')[0].n
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status,total_amount&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

try {
  // ── 1. `..` keys refused per bucket ────────────────────────────────────────
  const U = await createUser('storage')
  for (const bucket of ['listing-images', 'avatars', 'verification-docs', 'message-images']) {
    const ctrlName = `${U.id}/a/${crypto.randomUUID()}.png`
    const c = await upload(U.token, bucket, ctrlName, PNG, 'image/png')
    if (ok(c)) created.objects.push({ bucket, name: ctrlName })
    const stored = ok(c) ? objectRow(bucket, ctrlName) : null
    check(`1. ${bucket}: CONTROL normal key in own folder is accepted and stored literally`,
      ok(c) && stored?.name === ctrlName, `${c.status} ${msg(c).slice(0, 120)} stored ${stored?.name}`)

    // `<uid>/a/../<uuid>.png` would normalise to `<uid>/<uuid>.png` — which the
    // folder policy ALLOWS — so a refusal here can only be the `..` check.
    const badName = `${U.id}/a/../${crypto.randomUUID()}.png`
    const r = await upload(U.token, bucket, badName, PNG, 'image/png')
    if (ok(r)) created.objects.push({ bucket, name: badName })
    const leaked = sql(`select count(*)::int as n from storage.objects where bucket_id = '${bucket}' and name like '${U.id}/%' and name ~ '(^|/)\\.\\.(/|$)'`)[0].n
    check(`1. ${bucket}: key with a .. segment is refused and nothing is stored`,
      !ok(r) && leaked === 0, `${r.status} ${msg(r).slice(0, 120)} stored-with-dotdot ${leaked}`)
  }
  // avatars is the one bucket with an UPDATE policy (upsert): an upsert onto a
  // `..` key is refused too; control: upsert onto the normal key succeeds.
  {
    const ctrlName = `${U.id}/up-${stamp}.png`
    const put = (key) => fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${key.split('/').map(encodeURIComponent).join('%2F')}`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${U.token}`, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: PNG,
    })
    const c1 = await put(ctrlName)
    const c2 = await put(ctrlName)
    created.objects.push({ bucket: 'avatars', name: ctrlName })
    check('1. avatars: CONTROL upsert onto a normal key succeeds twice', c1.ok && c2.ok, `${c1.status} ${c2.status}`)
    const r = await put(`${U.id}/b/../up-${stamp}.png`)
    check('1. avatars: upsert onto a .. key is refused', !r.ok, `${r.status}`)
  }

  // ── 2. handle_new_user avatar_url allowlist ───────────────────────────────
  const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocL-probe079=s96-c'
  const OWN = `${SUPABASE_URL}/storage/v1/object/public/avatars/probe/079.png`
  const cases = [
    ['javascript URI', 'javascript:alert(document.cookie)', null],
    ['arbitrary https host', 'https://evil.example.com/pixel.png', null],
    ['look-alike subdomain', 'https://lh3.googleusercontent.com.evil.example.com/a/x', null],
    ['userinfo trick', 'https://lh3.googleusercontent.com@evil.example.com/a/x', null],
    ['plain http Google', 'http://lh3.googleusercontent.com/a/x', null],
    ['own host, non-storage path', `${SUPABASE_URL}/auth/v1/logout`, null],
    ['CONTROL Google avatar', GOOGLE, GOOGLE],
    ['CONTROL own public storage', OWN, OWN],
  ]
  for (const [label, url, expected] of cases) {
    const u = await createUser(`avatar-${cases.findIndex((c) => c[0] === label)}`, { full_name: 'Probe 079', avatar_url: url })
    const { body: [p] } = await admin(`profiles?select=avatar_url,full_name&id=eq.${u.id}`)
    check(`2. signup avatar_url, ${label}: stored as ${expected === null ? 'null' : 'given'}`,
      p && p.avatar_url === expected && p.full_name === 'Probe 079', `stored ${JSON.stringify(p?.avatar_url)}`)
  }

  // ── 3. default privileges: a new table has no client grants ──────────────
  {
    const t = `probe_079_acl_${stamp}`
    created.tables.push(t)
    sql(`create table public.${t} (id int)`)
    const priv = (role, p) => sql(`select has_table_privilege('${role}', 'public.${t}', '${p}') as v`)[0].v
    for (const role of ['anon', 'authenticated']) {
      const got = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].filter((p) => priv(role, p))
      check(`3. new table: ${role} inherits no SELECT/INSERT/UPDATE/DELETE`, got.length === 0, got.join(',') || 'none')
    }
    check('3. CONTROL: service_role still inherits SELECT and INSERT', priv('service_role', 'SELECT') && priv('service_role', 'INSERT'))
    sql(`grant select on public.${t} to authenticated`)
    check('3. CONTROL: an explicit grant in a migration still takes effect', priv('authenticated', 'SELECT') && !priv('authenticated', 'INSERT'))
    sql(`drop table public.${t}`)
    const acl = sql(`select defaclacl::text as a from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'`)[0]?.a ?? ''
    check('3. postgres default ACL in public names neither anon nor authenticated', !/anon=|authenticated=/.test(acl), acl)
  }

  // ── 4. quote_delivery_fee rate limit ──────────────────────────────────────
  {
    const H = await createUser('host')
    await admin(`profiles?id=eq.${H.id}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true }) })
    const { status, body } = await admin('listings', {
      method: 'POST',
      body: JSON.stringify({
        host_id: H.id, title: `Probe 079 ${stamp}`, brand: 'Sony', model: 'A7 IV', category: 'mirrorless',
        condition: 'excellent', description: 'Probe listing for 079.', daily_price: 1000, security_deposit: 0,
        city: 'Naga City', province: 'Camarines Sur', images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
        is_active: true, is_draft: false, latitude: 13.62144, longitude: 123.19436, location_is_exact: true,
        delivery_fee: 150, delivery_fee_per_km: 0,
      }),
    })
    if (status !== 201) throw new Error('listing: ' + JSON.stringify(body))
    created.listings.push(body[0].id)
    const R = await createUser('renter')
    const args = { p_listing_id: body[0].id, p_delivery_lat: 13.63, p_delivery_lng: 123.2 }
    let firstFail = null
    let firstFailRes = null
    let allFeesRight = true
    for (let i = 1; i <= 121; i++) {
      const r = await rpc(R.token, 'quote_delivery_fee', args)
      if (!ok(r)) { firstFail = i; firstFailRes = r; break }
      if (r.body?.[0]?.fee !== 150) allFeesRight = false
    }
    check('4. CONTROL: quotes 1–120 all succeed with the right fee', firstFail === 121 && allFeesRight, `first failure at ${firstFail}`)
    check('4. quote 121 is refused with the readable message',
      firstFailRes?.status === 400 && msg(firstFailRes).includes('Too many delivery quotes — please wait a moment.'),
      `${firstFailRes?.status} ${msg(firstFailRes).slice(0, 120)}`)
    const hits = (await admin(`rate_limit_hits?select=key&key=eq.quote:${R.id}`)).body.length
    check('4. the limiter recorded exactly 120 hits under quote:<uid>', hits === 120, `${hits}`)
    const other = await createUser('renter2')
    const o = await rpc(other.token, 'quote_delivery_fee', args)
    check('4. CONTROL: a different renter is not throttled (per-user key)', ok(o) && o.body?.[0]?.fee === 150, `${o.status} ${msg(o).slice(0, 80)}`)
    await admin(`rate_limit_hits?key=eq.quote:${R.id}`, { method: 'DELETE' })
    const again = await rpc(R.token, 'quote_delivery_fee', args)
    check('4. CONTROL: once the window is clear the same renter quotes again', ok(again) && again.body?.[0]?.fee === 150, `${again.status}`)
    const vol = sql(`select provolatile from pg_proc where proname = 'quote_delivery_fee'`)[0].provolatile
    check('4. quote_delivery_fee is VOLATILE (the limiter writes)', vol === 'v', vol)
    const acl = sql(`select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name='quote_delivery_fee'`).map((x) => x.grantee)
    check('4. quote_delivery_fee grants unchanged (no anon/PUBLIC)', acl.includes('authenticated') && !acl.some((g) => ['anon', 'PUBLIC'].includes(g)), acl.join(','))
  }

  // ── 5. magic bytes ────────────────────────────────────────────────────────
  {
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    const html = await checkImageFile(new File([HTML], 'listing-photo.png', { type: 'image/png' }), types, 'photo')
    check('5. real module: HTML labelled image/png is refused with a readable message',
      html.type === null && /isn't a real .*image/.test(html.error), html.error)
    const png = await checkImageFile(new File([PNG], 'real.png', { type: 'image/png' }), types, 'photo')
    check('5. CONTROL real module: a real PNG is accepted as image/png', png.type === 'image/png' && png.error === null)
    const mislabelled = await checkImageFile(new File([PNG], 'real.jpg', { type: 'image/jpeg' }), types, 'photo')
    check('5. real module: a PNG labelled image/jpeg is accepted but typed by its bytes', mislabelled.type === 'image/png')
    const b = (arr) => new Uint8Array(arr)
    const s = (str) => [...Buffer.from(str)]
    check('5. sniff JPEG', sniffImageBytes(b([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])) === 'image/jpeg')
    check('5. sniff WebP', sniffImageBytes(b([...s('RIFF'), 1, 2, 3, 4, ...s('WEBPVP8 ')])) === 'image/webp')
    check('5. sniff AVIF (major brand)', sniffImageBytes(b([0, 0, 0, 0x1c, ...s('ftypavif'), 0, 0, 0, 0, ...s('avifmif1miaf')])) === 'image/avif')
    check('5. sniff AVIF (compatible brand only)', sniffImageBytes(b([0, 0, 0, 0x18, ...s('ftypmif1'), 0, 0, 0, 0, ...s('miafavif')])) === 'image/avif')
    check('5. HEIC ftyp is not AVIF', sniffImageBytes(b([0, 0, 0, 0x18, ...s('ftypheic'), 0, 0, 0, 0, ...s('mif1heic')])) === null)
    check('5. RIFF WAVE is not WebP', sniffImageBytes(b([...s('RIFF'), 1, 2, 3, 4, ...s('WAVEfmt ')])) === null)
    // Why the client check exists: Storage trusts the declared type.
    const name = `${U.id}/${crypto.randomUUID()}.png`
    const up = await upload(U.token, 'listing-images', name, HTML, 'image/png')
    if (ok(up)) created.objects.push({ bucket: 'listing-images', name })
    check('5. (documents the gap) Storage itself accepts HTML bytes under an image/png label', ok(up), `${up.status} ${msg(up).slice(0, 100)}`)
  }
} catch (e) {
  check('script ran without throwing', false, String(e?.stack ?? e))
} finally {
  await cleanup()
  const detail = await proveCleanup()
  check('cleanup: every probe user, profile, notification, rate_limit_hits row, storage object, listing and table is gone', detail.length === 0, detail.join(', '))
  for (const t of TABLES) {
    const n = await countOf(t)
    check(`cleanup: ${t} count back at baseline`, n === before[t], `${before[t]} -> ${n}`)
  }
  const hitsAfter = sql('select count(*)::int as n from public.rate_limit_hits')[0].n
  check('cleanup: rate_limit_hits count not above baseline', hitsAfter <= hitsBefore, `${hitsBefore} -> ${hitsAfter}`)
  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status,total_amount&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('forbidden host untouched', JSON.stringify(fHostAfter) === JSON.stringify(fHostBefore))
  check('forbidden booking untouched', JSON.stringify(fBookingAfter) === JSON.stringify(fBookingBefore))
  done()
}
