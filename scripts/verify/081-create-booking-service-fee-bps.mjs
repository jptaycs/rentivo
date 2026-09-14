// Verifies migration 081 (create_booking reads and stamps the admin-set
// platform service fee, spec 2026-09-14 §4.1; plan 2026-09-14, Task B4).
//
// Proves: a real committed booking is charged and stamped at the LIVE rate
// (500 bps); a rolled-back probe that changes the rate to 750 mid-transaction
// charges and stamps 750 on a NEW booking while a booking made moments
// earlier at 500 is provably unchanged (rate changes are not retroactive);
// the identical probe shape with no rate change still stamps 500 (the
// control that attributes the 750 to the rate change, not to probe
// machinery); create_booking fails CLOSED — raises, charges nothing — when
// platform_settings has no row; exactly one create_booking overload exists
// with its pre-081 ACL; the live function body differs from the pre-081
// capture by EXACTLY the four hunks 081's migration comment describes;
// delivery is still excluded from the commission base; the 076 booking cap
// and 077 guard_booking_insert triggers still fire under the rewritten body.
//
// Every authorisation claim uses a REAL signed-in session on the anon key;
// the service role is used only for setup, independent re-reads and cleanup.
// A rate change must never commit: it runs inside a `do $$ … $$` probe that
// ends by raising an exception carrying its result as JSON, so the whole
// transaction rolls back and we parse the result out of the error text. The
// harness itself (auth.uid() reflects the claimed uid; a sentinel insert
// provably does not survive) is proven before any probe result is trusted.
//
// The probe()/sqlLit() pair below is Task B2's CORRECTED version, not the
// plan's own sample: the plan's `JSON.stringify(JSON.stringify(claims))`
// produces a double-quoted string, which Postgres parses as an identifier,
// not a string literal — every claims-carrying probe raises a syntax error
// rather than running. Copied from scripts/verify/080-platform-service-fee.mjs
// (commit 764c5c7) per the coordinator's correction, not re-derived.
//
// Throwaway @example.com accounts only. The forbidden host and booking are
// only read, before and after.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/081-create-booking-service-fee-bps.mjs
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const created = { users: [], listings: [] }

// ── the rolled-back-probe helper (Task B2 Step 1, CORRECTED — see header) ──
function sqlLit(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}
function probe(sql, claims = null) {
  const preamble = claims
    ? `perform set_config('request.jwt.claims', ${sqlLit(JSON.stringify(claims))}, true);`
    : ''
  const body = `do $$\nbegin\n${preamble}\n${sql}\nend $$;`
  try {
    execFileSync('supabase', ['db', 'query', '--linked', body], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { raised: false, payload: null, error: null }
  } catch (e) {
    const rawStdout = e.stdout ?? ''
    const rawStderr = e.stderr ?? ''
    let payload = null
    try {
      const outer = JSON.parse(rawStdout)
      let m = outer?.error?.message ?? ''
      m = m.replace(/^unexpected status \d+: /, '')
      const inner = JSON.parse(m)
      const pgMsg = inner?.message ?? ''
      const match = pgMsg.match(/VERIFY ([\s\S]*?)(?:\nCONTEXT|$)/)
      payload = match ? match[1].trim() : null
    } catch {
      payload = null
    }
    return { raised: true, payload, error: `${rawStdout}${rawStderr}` }
  }
}
const sql = (q) => JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).rows

// ── generic helpers (house pattern, 077/078/080) ────────────────────────────
async function createUser(label) {
  const email = `probe-081-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  const token = await signIn(email, PW)
  return { id: j.id, token }
}
async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: token === SECRET ? SECRET : ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
    },
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

const utcToday = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
const day = (n) => new Date(utcToday.getTime() + n * 86400000).toISOString().slice(0, 10)

async function newListing(hostId, extra = {}) {
  const { status, body } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, title: `Probe 081 ${stamp}`, brand: 'Sony', model: 'A7 IV',
      category: 'mirrorless', condition: 'excellent', description: 'Probe listing for 081.',
      daily_price: 1000, security_deposit: 0, delivery_fee: 100, delivery_fee_per_km: 0,
      city: 'Manila', province: 'Metro Manila',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false, is_instant_book: false,
      latitude: 14.5995, longitude: 120.9842, location_is_exact: true, ...extra,
    }),
  })
  if (status !== 201) throw new Error('newListing: ' + JSON.stringify(body))
  created.listings.push(body[0].id)
  return body[0].id
}
const book = (u, listingId, from, to, extra = {}) =>
  rpc(u.token, 'create_booking', { p_listing_id: listingId, p_pickup_date: from, p_return_date: to, p_payment_method: 'qrph', ...extra })
const markPaid = (bookingId) => rpc(SECRET, 'mark_booking_paid', { p_booking_id: bookingId, p_paymongo_ref: 'pi_probe_081' })
const setStatus = (u, bookingId, status) =>
  asUser(u.token, `bookings?id=eq.${bookingId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
const readBooking = async (id) => (await admin(`bookings?select=*&id=eq.${id}`)).body[0]

// Independent JS oracle for the fee, mirroring Postgres `round(rental *
// bps/10000.0)::integer` (rounds half away from zero, matching floor((r*bps+5000)/10000)
// for positive integers) — NOT Math.round, which differs at exact halves.
const feeFor = (rental, bps) => Math.floor((rental * bps + 5000) / 10000)

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
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
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
    const rl = (await admin(`rate_limit_hits?select=key&key=like.*${id}*`)).body.length
    if (rl) { leftovers += rl; detail.push(`rate_limit_hits(listing):${rl}`) }
  }
  return { leftovers, detail }
}

// ── the pre-081 live body, captured verbatim (md5 ec309539300d75e69a905942b49fa484,
// per Task B3's own capture) — this state no longer exists live, so it must
// be a literal constant here, exactly as migration 081's own guard treats it. ──
const OLD_BODY = `CREATE OR REPLACE FUNCTION public.create_booking(p_listing_id uuid, p_pickup_date date, p_return_date date, p_is_delivery boolean DEFAULT false, p_delivery_address text DEFAULT NULL::text, p_payment_method payment_method DEFAULT NULL::payment_method, p_renter_notes text DEFAULT NULL::text, p_promo_code text DEFAULT NULL::text, p_delivery_lat numeric DEFAULT NULL::numeric, p_delivery_lng numeric DEFAULT NULL::numeric)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_fee_rate    constant numeric := 0.05;

  v_renter     uuid := auth.uid();
  v_listing    public.listings%rowtype;
  v_promo      public.promo_codes%rowtype;
  v_days       integer;
  v_rental     integer;
  v_discount   integer := 0;
  v_service    integer;
  v_protection constant integer := 0;  -- discontinued, see 035
  v_delivery   integer := 0;           -- 038: change 1 of 4
  v_road_km    integer;                -- 078
  v_booking    public.bookings;
begin
  if v_renter is null then
    raise exception 'You must be signed in to book.';
  end if;

  -- Lock the listing row so concurrent bookings serialize on it
  select * into v_listing
  from public.listings
  where id = p_listing_id and is_active = true and is_draft = false
  for update;
  if not found then
    raise exception 'Listing not found or no longer available.';
  end if;
  if v_listing.host_id = v_renter then
    raise exception 'You cannot book your own listing.';
  end if;

  -- 045: A suspended host's gear is off the marketplace. RLS already hides it
  -- from every client read path, but this function is security definer and
  -- bypasses RLS, so without this a direct RPC call could still book a
  -- suspended host. The message deliberately matches the not-found message
  -- above — a renter has no business learning the moderation state of a
  -- stranger's account.
  if exists (
    select 1 from public.profiles p
    where p.id = v_listing.host_id and p.suspended_at is not null
  ) then
    raise exception 'Listing not found or no longer available.';
  end if;

  if p_pickup_date < current_date then
    raise exception 'Pickup date cannot be in the past.';
  end if;
  if p_return_date <= p_pickup_date then
    raise exception 'Return date must be after the pickup date.';
  end if;
  if p_is_delivery and coalesce(trim(p_delivery_address), '') = '' then
    raise exception 'A delivery address is required for delivery.';
  end if;

  -- 038: change 2 of 4 — mirrors the host_qr guard above. A NULL fee means
  -- the host never opted into delivery, so a delivery booking is invalid.
  if p_is_delivery and v_listing.delivery_fee is null then
    raise exception 'This host does not offer delivery.';
  end if;

  if exists (
    select 1 from public.availability_blocks
    where listing_id = p_listing_id
      and blocked_on between p_pickup_date and p_return_date - 1
  ) then
    raise exception 'The selected dates are no longer available.';
  end if;

  v_days := p_return_date - p_pickup_date;

  if v_days >= 30 and v_listing.monthly_price is not null then
    v_rental := round(v_listing.monthly_price / 30.0 * v_days);
  elsif v_days >= 7 and v_listing.weekly_price is not null then
    v_rental := round(v_listing.weekly_price / 7.0 * v_days);
  else
    v_rental := v_listing.daily_price * v_days;
  end if;

  -- Service fee is charged on the rental only. The delivery fee is a
  -- pass-through to the host, not a commission base.
  v_service := round(v_rental * service_fee_rate)::integer;

  -- 038: change 3 of 4 — read from the locked listing row, never a parameter.
  -- 078: base + distance, from the listing's PUBLIC approx point (never the
  -- exact pin), through the same function quote_delivery_fee uses.
  if p_is_delivery then
    select q.fee, q.road_km into v_delivery, v_road_km
    from public.delivery_fee_for(v_listing.delivery_fee, v_listing.delivery_fee_per_km,
      v_listing.location_is_exact, v_listing.approx_latitude, v_listing.approx_longitude,
      p_delivery_lat, p_delivery_lng) q;
  end if;

  -- 071: promo codes are discontinued. p_promo_code is still accepted so no
  -- caller's signature breaks, but it is IGNORED — never looked up, never
  -- redeemed, and it never reduces the amount. A discount came out of
  -- Rentivo's own margin, not the host's: the host is paid rental_fee (stored
  -- PRE-discount, 046:105), so net was service_fee - discount, i.e. NEGATIVE
  -- for any code above the 5% service fee. Every code that existed was 10-20%.

  -- 038: change 4 of 4 — delivery_fee added to the column list and the total.
  insert into public.bookings (
    listing_id, renter_id, host_id, pickup_date, return_date,
    rental_fee, security_deposit, service_fee, protection_fee, delivery_fee,
    promo_code, discount, total_amount,
    status, is_delivery, delivery_address, payment_method, renter_notes,
    delivery_distance_km, delivery_latitude, delivery_longitude
  ) values (
    p_listing_id, v_renter, v_listing.host_id, p_pickup_date, p_return_date,
    -- 070: deposit is no longer charged; stored 0 like protection_fee (035).
    v_rental, 0, v_service, v_protection, v_delivery,
    -- 071: no promo is recorded and no discount is applied.
    null, 0,
    v_rental + v_service + v_protection + v_delivery,
    'pending', p_is_delivery, nullif(trim(p_delivery_address), ''),
    p_payment_method, nullif(trim(p_renter_notes), ''),
    -- 078: a flat-fee delivery stores no coordinates — nothing needed them.
    case when p_is_delivery then v_road_km end,
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lat end,
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end
  )
  returning * into v_booking;

  return v_booking;
end;
$function$
`
const OLD_MD5 = 'ec309539300d75e69a905942b49fa484'
// The four original lines the migration's four hunks replace — extracted by
// `diff -u` against the OLD_BODY above and the intended post-081 body at
// authoring time. check 7 re-derives the diff live and asserts these are
// exactly the removed lines — this list is the expectation, not a shortcut.
const EXPECTED_REMOVED_LINES = [
  '  service_fee_rate    constant numeric := 0.05;',
  '  -- 038: change 2 of 4 — mirrors the host_qr guard above. A NULL fee means',
  '    delivery_distance_km, delivery_latitude, delivery_longitude',
  '    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end',
]

// ════════════════════════════════════════════════════════════════════════
// Check 10 (spec §14's "regression suite — re-run 076/077/078/079/079 and
// require all to pass") is deliberately NOT embedded here. It is fulfilled
// by Task B4 Step 2's separate invocations of those five scripts — the brief
// lists them as distinct `node ...` commands after this script, not as
// something for THIS script to spawn. One of them (076-rate-limiting) starts
// its own `next start` on port 3100 and kills whatever already holds that
// port first; embedding it here would risk killing another concurrent
// worktree's dev server, which this script has no business doing. Run it
// separately, once port 3100 is confirmed free of other agents' work.
const countOf = async (t) => (await admin(`${t}?select=id&limit=100000`)).body.length
const TABLES = ['bookings', 'conversations', 'messages', 'notifications', 'availability_blocks', 'listings', 'profiles']
const before = {}
for (const t of TABLES) before[t] = await countOf(t)
const rateBefore = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
check('sanity: platform_settings starts at 500 bps', rateBefore === 500, `${rateBefore}`)
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status,total_amount,service_fee_bps&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

try {
  // ── 1. harness proof — before trusting any probe result ───────────────────
  {
    const uid = '22222222-2222-2222-2222-222222222222'
    const r = probe("raise exception 'VERIFY %', auth.uid();", { sub: uid, role: 'authenticated' })
    check('1. harness: auth.uid() inside a probe equals the claimed uid', r.raised && r.payload === uid, `${r.payload} | ${r.error?.slice(0, 200)}`)

    const sentinelSql = `insert into public.admin_actions (admin_email, action, target_user_id, detail) values ('probe-081@example.com','probe_rollback_sentinel',null,'{}'::jsonb); raise exception 'VERIFY %', 'sentinel-inserted';`
    const r2 = probe(sentinelSql)
    check('1. harness: sentinel-insert probe raises as expected', r2.raised && r2.payload === 'sentinel-inserted', `${r2.payload}`)
    const survived = (await admin('admin_actions?select=id&action=eq.probe_rollback_sentinel')).body
    check('1. harness: the sentinel row does NOT survive — the probe truly rolled back', survived.length === 0, `${survived.length} rows found`)
  }

  // ── setup ──────────────────────────────────────────────────────────────
  const H = await createUser('host')
  await admin(`profiles?id=eq.${H.id}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe 081 Host' }) })
  const R = await createUser('renter')
  const R2 = await createUser('renter2')
  const L = await newListing(H.id)

  // ── 2. stamped at the live rate (500), real committed booking ─────────────
  const FROM2 = day(10), TO2 = day(12) // 2 days: rental = 2000
  const b2 = await book(R, L, FROM2, TO2)
  check('2. renter books at the live rate — request succeeds', ok(b2), `${b2.status} ${msg(b2).slice(0, 200)}`)
  const booking2 = ok(b2) ? b2.body : null
  check('2. service_fee_bps === 500', booking2?.service_fee_bps === 500, `${booking2?.service_fee_bps}`)
  check('2. service_fee === floor((rental*500+5000)/10000)',
    booking2 && booking2.service_fee === feeFor(booking2.rental_fee, 500),
    `rental ${booking2?.rental_fee} fee ${booking2?.service_fee} expected ${booking2 && feeFor(booking2.rental_fee, 500)}`)
  check('2. total_amount === rental_fee + service_fee + delivery_fee (protection/deposit are 0)',
    booking2 && booking2.total_amount === booking2.rental_fee + booking2.service_fee + booking2.delivery_fee,
    `${booking2?.total_amount} vs ${booking2 && booking2.rental_fee + booking2.service_fee + booking2.delivery_fee}`)

  // ── 3. a rate change applies to a NEW booking, never to check 2's ─────────
  const FROM3 = day(11), TO3 = day(13) // overlaps check 2's dates on purpose — fine, both pending
  const sql3 = `
    declare v_new record; v_old record;
    begin
      -- Order note: the plan describes admin-change, then claims-switch, then
      -- create_booking. We are already a superuser connection (a direct psql
      -- session bypasses grants entirely, per the rate-limit exemption this
      -- project documents for a claims-less session), so set_service_fee_bps
      -- succeeds regardless of whose JWT claims are active — only
      -- create_booking's own auth.uid() read needs the renter's claims, and
      -- those are set by probe()'s preamble BEFORE this block runs. The
      -- behaviour under test — one rate read, used twice, on THIS call only —
      -- is identical either way.
      perform public.set_service_fee_bps(750, 'probe-081', 'probe-081@example.com');
      select * into v_new from public.create_booking(${sqlLit(L)}::uuid, ${sqlLit(FROM3)}::date, ${sqlLit(TO3)}::date, false, null, 'qrph'::payment_method, null, null, null, null);
      select rental_fee, service_fee, service_fee_bps into v_old from public.bookings where id = ${sqlLit(booking2?.id ?? '00000000-0000-0000-0000-000000000000')}::uuid;
      raise exception 'VERIFY %', jsonb_build_object(
        'new_bps', v_new.service_fee_bps, 'new_fee', v_new.service_fee, 'new_rental', v_new.rental_fee,
        'old_bps', v_old.service_fee_bps, 'old_fee', v_old.service_fee
      );
    end;
  `
  const r3 = probe(sql3, { sub: R.id, role: 'authenticated' })
  let p3 = null
  try { p3 = JSON.parse(r3.payload) } catch { /* leave null */ }
  check('3. probe raised with a JSON payload', r3.raised && p3 !== null, r3.error?.slice(0, 300) ?? r3.payload)
  check('3. new_bps === 750', p3?.new_bps === 750, `${p3?.new_bps}`)
  check('3. new_fee === floor((new_rental*750+5000)/10000)',
    p3 && p3.new_fee === feeFor(p3.new_rental, 750), `rental ${p3?.new_rental} fee ${p3?.new_fee} expected ${p3 && feeFor(p3.new_rental, 750)}`)
  check('3. CONTROL: old_bps (check 2\'s booking) is still 500 — a rate change is NOT retroactive', p3?.old_bps === 500, `${p3?.old_bps}`)
  check('3. CONTROL: old_fee (check 2\'s booking) is unchanged', p3?.old_fee === booking2?.service_fee, `${p3?.old_fee} vs ${booking2?.service_fee}`)

  const rateAfter3 = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
  check('3. after the probe, platform_settings.service_fee_bps is still 500', rateAfter3 === 500, `${rateAfter3}`)
  const booking3ProbeCount = (await admin(`bookings?select=id&listing_id=eq.${L}&pickup_date=eq.${FROM3}&return_date=eq.${TO3}`)).body.length
  check('3. the booking created inside the rolled-back probe does not exist', booking3ProbeCount === 0, `${booking3ProbeCount} row(s)`)
  const booking2Reread = await readBooking(booking2.id)
  check('3. check 2\'s real booking still reads service_fee_bps=500 after the probe', booking2Reread?.service_fee_bps === 500, `${booking2Reread?.service_fee_bps}`)

  // ── 4. same probe shape, no rate change — control for check 3 ─────────────
  const sql4 = `
    declare v_new record;
    begin
      select * into v_new from public.create_booking(${sqlLit(L)}::uuid, ${sqlLit(FROM3)}::date, ${sqlLit(TO3)}::date, false, null, 'qrph'::payment_method, null, null, null, null);
      raise exception 'VERIFY %', jsonb_build_object('new_bps', v_new.service_fee_bps, 'new_fee', v_new.service_fee, 'new_rental', v_new.rental_fee);
    end;
  `
  const r4 = probe(sql4, { sub: R.id, role: 'authenticated' })
  let p4 = null
  try { p4 = JSON.parse(r4.payload) } catch { /* leave null */ }
  check('4. CONTROL: identical probe shape at the live rate stamps 500, not 750 — attributes check 3 to the rate change',
    r4.raised && p4?.new_bps === 500 && p4?.new_fee === feeFor(p4.new_rental, 500),
    `${JSON.stringify(p4)} expected fee ${p4 && feeFor(p4.new_rental, 500)}`)
  const rateAfter4 = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
  check('4. after this probe too, platform_settings.service_fee_bps is still 500', rateAfter4 === 500, `${rateAfter4}`)

  // ── 5. fails closed with no settings row ───────────────────────────────────
  const FROM5 = day(14), TO5 = day(16)
  const sql5 = `
    declare v_new record;
    begin
      delete from public.platform_settings;
      begin
        select * into v_new from public.create_booking(${sqlLit(L)}::uuid, ${sqlLit(FROM5)}::date, ${sqlLit(TO5)}::date, false, null, 'qrph'::payment_method, null, null, null, null);
        raise exception 'VERIFY %', 'unexpected-success';
      exception when others then
        raise exception 'VERIFY %', SQLERRM;
      end;
    end;
  `
  const r5 = probe(sql5, { sub: R.id, role: 'authenticated' })
  check('5. with platform_settings deleted, create_booking raises "not configured"',
    r5.raised && (r5.payload ?? '').includes('not configured'), `${r5.payload} | ${r5.error?.slice(0, 200)}`)

  const FROM5b = day(17), TO5b = day(19)
  const sql5ctrl = `
    declare v_new record;
    begin
      select * into v_new from public.create_booking(${sqlLit(L)}::uuid, ${sqlLit(FROM5b)}::date, ${sqlLit(TO5b)}::date, false, null, 'qrph'::payment_method, null, null, null, null);
      raise exception 'VERIFY %', jsonb_build_object('ok', true, 'bps', v_new.service_fee_bps);
    end;
  `
  const r5ctrl = probe(sql5ctrl, { sub: R.id, role: 'authenticated' })
  let p5ctrl = null
  try { p5ctrl = JSON.parse(r5ctrl.payload) } catch { /* leave null */ }
  check('5. CONTROL: the same call shape with the settings row present succeeds and returns a booking',
    r5ctrl.raised && p5ctrl?.ok === true && p5ctrl?.bps === 500, `${JSON.stringify(p5ctrl)}`)

  const settingsRowsAfter5 = sql('select service_fee_bps from public.platform_settings')
  check('5. after the probe, the settings row still exists with service_fee_bps=500',
    settingsRowsAfter5.length === 1 && settingsRowsAfter5[0].service_fee_bps === 500, JSON.stringify(settingsRowsAfter5))

  // ── 6. one overload, ACL unchanged ─────────────────────────────────────────
  {
    const n = sql("select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='create_booking'")
    check('6. exactly one create_booking overload', n[0].n === 1, `count ${n[0].n}`)
    const g = sql("select grantee, privilege_type from information_schema.routine_privileges where routine_schema='public' and routine_name='create_booking' order by grantee")
    const got = g.map((x) => `${x.grantee}:${x.privilege_type}`).sort()
    const EXPECTED = ['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']
    check('6. create_booking grants unchanged from the pre-081 capture', JSON.stringify(got) === JSON.stringify(EXPECTED), got.join(', '))
  }

  // ── 7. body diff is exactly the four hunks ─────────────────────────────────
  {
    const row = sql("select pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as md5 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='create_booking'")[0]
    check('7. live md5 differs from the pre-081 capture — 081 actually replaced the function', row.md5 !== OLD_MD5, row.md5)
    check('7. live md5 recorded for the next rewrite of create_booking', true, row.md5)

    const dir = mkdtempSync(join(tmpdir(), 'cb081-'))
    const oldFile = join(dir, 'old.sql')
    const newFile = join(dir, 'new.sql')
    writeFileSync(oldFile, OLD_BODY)
    writeFileSync(newFile, row.def)
    let diffOut = ''
    try {
      diffOut = execFileSync('diff', ['-u', oldFile, newFile], { encoding: 'utf8' })
    } catch (e) {
      // diff exits 1 when files differ — that's the expected case, not a failure.
      diffOut = e.stdout ?? ''
    }
    rmSync(dir, { recursive: true, force: true })

    const hunkCount = (diffOut.match(/^@@/gm) ?? []).length
    check('7. diff contains exactly 4 hunks', hunkCount === 4, `${hunkCount} hunks\n${diffOut.slice(0, 1500)}`)
    const removedLines = diffOut.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
    check('7. the removed lines are exactly the four originals',
      JSON.stringify(removedLines.map((l) => l.slice(1))) === JSON.stringify(EXPECTED_REMOVED_LINES),
      JSON.stringify(removedLines))
  }

  // ── 8. delivery still excluded from the fee base ──────────────────────────
  const FROM8 = day(20), TO8 = day(22)
  const b8 = await book(R, L, FROM8, TO8, { p_is_delivery: true, p_delivery_address: 'Probe St, Manila' })
  check('8. delivery booking succeeds', ok(b8), `${b8.status} ${msg(b8).slice(0, 200)}`)
  const booking8 = ok(b8) ? b8.body : null
  check('8. service_fee is unchanged by the ₱100 delivery fee — floor((rental*500+5000)/10000)',
    booking8 && booking8.service_fee === feeFor(booking8.rental_fee, 500),
    `rental ${booking8?.rental_fee} fee ${booking8?.service_fee} expected ${booking8 && feeFor(booking8.rental_fee, 500)}`)
  check('8. total_amount === rental_fee + service_fee + 100',
    booking8 && booking8.total_amount === booking8.rental_fee + booking8.service_fee + 100 && booking8.delivery_fee === 100,
    `${booking8?.total_amount} delivery ${booking8?.delivery_fee}`)

  // ── 9. rate-limit and lifecycle triggers still fire (076/077) ─────────────
  const FROM9 = day(30), TO9 = day(33)
  const b9 = await book(R, L, FROM9, TO9)
  check('9. setup: renter books the dates to be confirmed', ok(b9), `${b9.status} ${msg(b9).slice(0, 160)}`)
  const paid9 = ok(b9) ? await markPaid(b9.body.id) : null
  check('9. setup: service role marks it paid', paid9 && ok(paid9), `${paid9?.status} ${paid9 && msg(paid9).slice(0, 160)}`)
  const conf9 = ok(b9) ? await setStatus(H, b9.body.id, 'confirmed') : null
  check('9. setup: host confirms it (enforce_booking_transition genuinely approves)',
    conf9 && ok(conf9) && conf9.body?.[0]?.status === 'confirmed', `${conf9?.status} ${conf9 && msg(conf9).slice(0, 160)}`)

  const FROM9over = day(31), TO9over = day(34)
  const over9 = await book(R2, L, FROM9over, TO9over)
  check('9. REFUSED: overlapping booking against the confirmed booking still raises (guard_booking_insert, 077)',
    raised(over9, 'no longer available'), `${over9.status} ${msg(over9).slice(0, 160)}`)
  const free9 = await book(R2, L, day(40), day(41))
  check('9. CONTROL: a booking over free dates on the same listing still succeeds', ok(free9), `${free9.status} ${msg(free9).slice(0, 160)}`)

  // 10. regression suite — see the note above this try block: run separately
  // (Task B4 Step 2), not embedded here.
} catch (e) {
  check('script ran without throwing', false, String(e?.stack ?? e))
} finally {
  await cleanup()
  const { leftovers, detail } = await proveCleanup()
  check('11. cleanup: every probe booking, notification, conversation, rate_limit_hits row, listing and user is gone', leftovers === 0, detail.join(', '))
  for (const t of TABLES) {
    const n = await countOf(t)
    check(`11. baseline: ${t} count unchanged`, n === before[t], `${before[t]} -> ${n}`)
  }
  const rateFinal = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
  check('11. baseline: platform_settings.service_fee_bps is STILL 500 after the whole run', rateFinal === 500, `${rateFinal}`)
  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status,total_amount,service_fee_bps&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('11. forbidden host untouched', JSON.stringify(fHostAfter) === JSON.stringify(fHostBefore))
  check('11. forbidden booking untouched', JSON.stringify(fBookingAfter) === JSON.stringify(fBookingBefore))
  done()
}
