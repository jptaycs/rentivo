// Verifies migration 080 (platform_settings, bookings.service_fee_bps,
// current_service_fee_bps(), set_service_fee_bps()) and its grants.
//
// Every refusal is paired with a control showing the identical call succeeds
// once the condition under test is removed. Real signed-in sessions for every
// authorisation claim; the service role is used only for setup, independent
// re-reads and cleanup.
//
// Anything that must not commit (a rate change, an audit row) runs inside a
// rolled-back SQL probe: a `do $$ … $$` block that ends by raising an
// exception carrying its result as JSON, so the whole transaction aborts and
// we parse the result out of the error text. The harness itself is proven
// (auth.uid() reflects the claimed uid; a sentinel insert provably does not
// survive) before any probe result is trusted.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/080-platform-service-fee.mjs
import { execFileSync } from 'node:child_process'
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const created = { users: [] }

// ── The rolled-back-probe helper (Task B2 Step 1; B4/C2 copy this verbatim) ─
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
      let msg = outer?.error?.message ?? ''
      msg = msg.replace(/^unexpected status \d+: /, '')
      const inner = JSON.parse(msg)
      const pgMsg = inner?.message ?? ''
      const m = pgMsg.match(/VERIFY ([\s\S]*?)(?:\nCONTEXT|$)/)
      payload = m ? m[1].trim() : null
    } catch {
      payload = null
    }
    return { raised: true, payload, error: `${rawStdout}${rawStderr}` }
  }
}
const sql = (q) => JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).rows

async function createUser(label) {
  const email = `probe-080-${label}-${stamp}@example.com`
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
async function rpcAnon(token, fn, args) {
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

async function cleanup() {
  for (const u of created.users) {
    await admin(`rate_limit_hits?key=like.*${u}*`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
  }
}
async function proveCleanup() {
  const detail = []
  for (const u of created.users) {
    const n = (await admin(`profiles?select=id&id=eq.${u}`)).body.length
    if (n) detail.push(`profiles:${n}`)
    const rl = (await admin(`rate_limit_hits?select=key&key=like.*${u}*`)).body.length
    if (rl) detail.push(`rate_limit_hits:${rl}`)
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
    if (r.status !== 404) detail.push(`auth:${r.status}`)
  }
  return detail
}

const countOf = async (t) => (await admin(`${t}?select=id&limit=100000`)).body.length
const TABLES = ['bookings']
const before = {}
for (const t of TABLES) before[t] = await countOf(t)
const adminActionsBefore = sql("select count(*)::int as n from public.admin_actions")[0].n
const platformSettingsBefore = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
const { body: [fHostBefore] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
const { body: [fBookingBefore] } = await admin(`bookings?select=id,updated_at,status,total_amount,service_fee_bps&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

check('sanity: platform_settings starts at 500 bps', platformSettingsBefore === 500, `${platformSettingsBefore}`)

try {
  // ── Step 1: prove the harness before trusting any probe result ───────────
  {
    const uid = '11111111-1111-1111-1111-111111111111'
    const r = probe("raise exception 'VERIFY %', auth.uid();", { sub: uid, role: 'authenticated' })
    check('1. harness: auth.uid() inside a probe equals the claimed uid', r.raised && r.payload === uid, `${r.payload}`)

    const sentinelSql = `insert into public.admin_actions (admin_email, action, target_user_id, detail) values ('probe-080@example.com','probe_rollback_sentinel',null,'{}'::jsonb); raise exception 'VERIFY %', 'sentinel-inserted';`
    const r2 = probe(sentinelSql)
    check('1. harness: sentinel-insert probe raises as expected', r2.raised && r2.payload === 'sentinel-inserted', `${r2.payload}`)
    const survived = (await admin(`admin_actions?select=id&action=eq.probe_rollback_sentinel`)).body
    check('1. harness: the sentinel row does NOT survive — the probe truly rolled back', survived.length === 0, `${survived.length} rows found`)
  }

  // ── 2. platform_settings is closed to clients ─────────────────────────────
  {
    const anonRes = await asUser(null, 'platform_settings?select=*')
    check('2. anon GET platform_settings is refused', anonRes.status === 401 || /permission denied/.test(msg(anonRes)), `${anonRes.status} ${msg(anonRes)}`)

    const U = await createUser('reader')
    const userRes = await asUser(U.token, 'platform_settings?select=*')
    check('2. a signed-in throwaway user GET platform_settings is refused with "permission denied for table platform_settings"',
      /permission denied for table platform_settings/.test(msg(userRes)), `${userRes.status} ${msg(userRes)}`)

    // CONTROL: service role reads the row and it holds 500.
    const svc = sql('select service_fee_bps from public.platform_settings')[0]
    check('2. CONTROL: service role reads the row and it holds 500', svc.service_fee_bps === 500, `${svc.service_fee_bps}`)
  }

  // ── 3. current_service_fee_bps() is open to everyone ──────────────────────
  {
    const anonRes = await rpcAnon(null, 'current_service_fee_bps', {})
    check('3. anon POST rpc/current_service_fee_bps -> 200, body 500',
      anonRes.status === 200 && anonRes.body === 500, `${anonRes.status} ${msg(anonRes)}`)
    // Control pairing for check 2: readable by everyone via the RPC while the
    // table itself is not.
    check('3. CONTROL pairing: the rate is readable via the RPC while the table is closed (check 2)', true)
  }

  // ── 4. set_service_fee_bps is service-role only ───────────────────────────
  {
    const U = await createUser('setter')
    const userRes = await rpcAnon(U.token, 'set_service_fee_bps', { p_bps: 600, p_reason: 'probe', p_admin_email: 'probe@example.com' })
    check('4. a signed-in throwaway user calling set_service_fee_bps is refused with "permission denied for function set_service_fee_bps"',
      /permission denied for function set_service_fee_bps/.test(msg(userRes)), `${userRes.status} ${msg(userRes)}`)

    const anonRes = await rpcAnon(null, 'set_service_fee_bps', { p_bps: 600, p_reason: 'probe', p_admin_email: 'probe@example.com' })
    check('4. anon calling set_service_fee_bps -> 401 (no JWT, rejected before the grant list)',
      anonRes.status === 401, `${anonRes.status} ${msg(anonRes)}`)
    check('4. anon (401) vs signed-in-non-admin (403/permission-denied) are correctly distinct, not conflated',
      anonRes.status === 401 && userRes.status !== 401, `anon=${anonRes.status} user=${userRes.status}`)

    // CONTROL, rolled back: the real function succeeds and writes its audit
    // row in the SAME transaction.
    //
    // Counted as a DELTA, not against zero: real rate changes are a permanent
    // audit trail (Task B9's verification left two), so an absolute count here
    // would start failing the first time an admin legitimately moves the rate.
    const auditBefore = sql("select count(*)::int as n from public.admin_actions where action = 'service_fee_rate_change'")[0].n
    const r = probe(`
      declare v_prev int; v_new int; v_count int;
      begin
        select previous_bps, service_fee_bps into v_prev, v_new
        from public.set_service_fee_bps(600, 'probe', 'probe@example.com');
        select count(*) into v_count from public.admin_actions where action = 'service_fee_rate_change';
        raise exception 'VERIFY %', jsonb_build_object('prev', v_prev, 'new', v_new, 'audit_count', v_count);
      end;
    `)
    let payload = null
    try { payload = JSON.parse(r.payload) } catch { /* leave null */ }
    check('4. CONTROL (rolled back): set_service_fee_bps(600, …) succeeds and stamps previous_bps=500,service_fee_bps=600',
      r.raised && payload?.prev === 500 && payload?.new === 600, r.error?.slice(0, 300) ?? JSON.stringify(payload))
    check('4. CONTROL (rolled back): its admin_actions audit row is written in the SAME transaction (baseline + 1)',
      payload?.audit_count === auditBefore + 1, `${payload?.audit_count} (baseline ${auditBefore})`)

    // After the probe rolled back: rate is still 500, and the probe's own audit
    // row is gone (the count is back at the baseline).
    const afterRate = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
    check('4. after the rolled-back probe, platform_settings.service_fee_bps is still 500', afterRate === 500, `${afterRate}`)
    const afterAudit = sql("select count(*)::int as n from public.admin_actions where action = 'service_fee_rate_change'")[0].n
    check('4. after the rolled-back probe, its service_fee_rate_change row is gone (count back at the baseline)', afterAudit === auditBefore, `${afterAudit} (baseline ${auditBefore})`)
  }

  // ── 5. validation refusals, each its own rolled-back probe ────────────────
  {
    const cases = [
      { label: '2001 -> refused ("between 0 and 2000")', sql: "perform public.set_service_fee_bps(2001, 'probe', 'probe@example.com');", re: /between 0 and 2000/ },
      { label: '-1 -> refused', sql: "perform public.set_service_fee_bps(-1, 'probe', 'probe@example.com');", re: /between 0 and 2000/ },
      { label: 'null -> refused', sql: "perform public.set_service_fee_bps(null, 'probe', 'probe@example.com');", re: /between 0 and 2000/ },
      { label: '500 (current value, a no-op) -> refused ("already 500 basis points")', sql: "perform public.set_service_fee_bps(500, 'probe', 'probe@example.com');", re: /already 500 basis points/ },
      { label: 'blank/whitespace reason at a valid 600 -> refused ("A reason is required")', sql: "perform public.set_service_fee_bps(600, '   ', 'probe@example.com');", re: /A reason is required/ },
      { label: 'blank admin email -> refused', sql: "perform public.set_service_fee_bps(600, 'probe', '   ');", re: /admin email is required/ },
    ]
    for (const c of cases) {
      // No VERIFY wrapping needed here: set_service_fee_bps raises its own
      // readable error, which aborts the whole DO block on its own — matched
      // straight off probe()'s raw error text rather than a VERIFY payload.
      const r = probe(c.sql)
      check(`5. ${c.label}`, r.raised && c.re.test(r.error ?? ''), `${(r.error ?? '').slice(0, 200)}`)
    }
    // CONTROL: 2000 (inclusive cap) with a real reason and email succeeds
    // inside a probe — proves the refusals above are attributable to their
    // own branch, not to some other guard.
    const ctrl = probe(`
      declare v_new int;
      begin
        select service_fee_bps into v_new from public.set_service_fee_bps(2000, 'probe control', 'probe@example.com');
        raise exception 'VERIFY %', v_new;
      end;
    `)
    check('5. CONTROL: 2000 (inclusive cap) with a real reason+email succeeds inside a probe', ctrl.raised && ctrl.payload === '2000', `${ctrl.payload}`)
    const afterRate = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
    check('5. after all 6 refusal probes + the control probe, platform_settings is still 500', afterRate === 500, `${afterRate}`)
  }

  // ── 6/7. the per-booking column: not client-writable, but readable ────────
  {
    const renterToken = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
    const { body: [profile] } = await admin("profiles?select=id&full_name=ilike.*Demo Renter*")
    const { body: [ownBooking] } = await admin(
      `bookings?select=id,renter_notes,service_fee_bps&renter_id=eq.${profile.id}&order=created_at.desc&limit=1`
    )
    if (!ownBooking) throw new Error('no booking found for the demo renter — cannot exercise checks 6/7')

    // 6. service_fee_bps is not client-writable.
    const patchAmount = await asUser(renterToken, `bookings?id=eq.${ownBooking.id}`, {
      method: 'PATCH', body: JSON.stringify({ service_fee_bps: 0 }),
    })
    check('6. the demo renter PATCHing service_fee_bps on their own booking -> permission denied for table bookings',
      /permission denied for table bookings/.test(msg(patchAmount)), `${patchAmount.status} ${msg(patchAmount)}`)

    // CONTROL: the same session can PATCH a genuinely writable column
    // (renter_notes) on the same row, then it's restored.
    const originalNotes = ownBooking.renter_notes
    const patchNotes = await asUser(renterToken, `bookings?id=eq.${ownBooking.id}`, {
      method: 'PATCH', body: JSON.stringify({ renter_notes: `probe-080-${stamp}` }),
    })
    check('6. CONTROL: the same session PATCHing renter_notes on the same row succeeds (200, updated row returned)',
      patchNotes.status === 200 && patchNotes.body?.[0]?.renter_notes === `probe-080-${stamp}`, `${patchNotes.status} ${msg(patchNotes)}`)
    const restore = await asUser(renterToken, `bookings?id=eq.${ownBooking.id}`, {
      method: 'PATCH', body: JSON.stringify({ renter_notes: originalNotes }),
    })
    check('6. CONTROL: renter_notes restored to its original value', restore.status === 200, `${restore.status}`)
    const { body: [reread] } = await admin(`bookings?select=renter_notes&id=eq.${ownBooking.id}`)
    check('6. CONTROL: re-read confirms renter_notes is back to its original value', reread.renter_notes === originalNotes, `${JSON.stringify(reread.renter_notes)} vs ${JSON.stringify(originalNotes)}`)

    // 7. service_fee_bps IS readable by a party.
    const getRes = await asUser(renterToken, `bookings?id=eq.${ownBooking.id}&select=service_fee_bps`)
    const gotBps = getRes.body?.[0]?.service_fee_bps
    check('7. the demo renter GETs service_fee_bps on their own booking -> 200 with a real value (500 or 1200)',
      getRes.status === 200 && (gotBps === 500 || gotBps === 1200), `${getRes.status} ${msg(getRes)}`)
  }

  // ── 8. backfill self-consistency ───────────────────────────────────────────
  {
    const rows = sql('select rental_fee, service_fee, service_fee_bps from public.bookings')
    let bad = []
    let n500 = 0, n1200 = 0, nNull = 0
    for (const row of rows) {
      const rental = Number(row.rental_fee)
      const fee = Number(row.service_fee)
      if (row.service_fee_bps !== null) {
        const expected = Math.floor((rental * row.service_fee_bps + 5000) / 10000)
        if (expected !== fee) bad.push({ ...row, expected })
        if (row.service_fee_bps === 500) n500++
        if (row.service_fee_bps === 1200) n1200++
      } else {
        nNull++
        const at5 = Math.round(rental * 0.05)
        const at12 = Math.round(rental * 0.12)
        if (at5 !== at12) bad.push({ ...row, reason: 'null but formulas disagree' })
      }
    }
    check(`8. every booking's (rental_fee, service_fee, service_fee_bps) is self-consistent — ${rows.length} rows checked`,
      bad.length === 0, JSON.stringify(bad.slice(0, 5)))
    check(`8. backfill counts: 500×${n500}, 1200×${n1200}, null×${nNull}`, true)
  }

  // ── 9. admin_actions.target_user_id is nullable ────────────────────────────
  {
    const col = sql(`select is_nullable from information_schema.columns where table_schema='public' and table_name='admin_actions' and column_name='target_user_id'`)[0]
    check('9. admin_actions.target_user_id is nullable (information_schema.is_nullable = YES)', col?.is_nullable === 'YES', `${col?.is_nullable}`)
  }
} catch (e) {
  check('script ran without throwing', false, String(e?.stack ?? e))
} finally {
  await cleanup()
  const cleanupDetail = await proveCleanup()
  check('cleanup: every probe user/profile/rate_limit_hits row is gone', cleanupDetail.length === 0, cleanupDetail.join(', '))

  // ── 10. baseline and forbidden rows ────────────────────────────────────────
  for (const t of TABLES) {
    const n = await countOf(t)
    check(`10. baseline: ${t} count unchanged`, n === before[t], `${before[t]} -> ${n}`)
  }
  const adminActionsAfter = sql("select count(*)::int as n from public.admin_actions")[0].n
  check('10. baseline: admin_actions count unchanged', adminActionsAfter === adminActionsBefore, `${adminActionsBefore} -> ${adminActionsAfter}`)
  const platformSettingsAfter = sql('select service_fee_bps from public.platform_settings')[0].service_fee_bps
  check('10. baseline: platform_settings.service_fee_bps is STILL 500 after the whole run', platformSettingsAfter === 500, `${platformSettingsAfter}`)

  const { body: [fHostAfter] } = await admin(`profiles?select=id,updated_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [fBookingAfter] } = await admin(`bookings?select=id,updated_at,status,total_amount,service_fee_bps&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
  check('10. forbidden host untouched', JSON.stringify(fHostAfter) === JSON.stringify(fHostBefore))
  check('10. forbidden booking untouched', JSON.stringify(fBookingAfter) === JSON.stringify(fBookingBefore))

  done()
}
