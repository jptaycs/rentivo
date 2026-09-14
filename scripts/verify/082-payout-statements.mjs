// Verifies migration 082 (payout statements): the statement columns and their
// invariants, the per-booking snapshot, the gapless per-year counter, the one
// eligibility definition, the four lifecycle RPCs, the three stubbed old
// functions, and every grant/RLS boundary around them.
//
// Every refusal is paired with a control showing the identical call succeeds
// once the condition under test is removed. Real signed-in sessions for every
// authorisation claim; the service role is used only for setup, independent
// re-reads and cleanup. Two throwaway hosts (HOST/H and HOSTF/HF) exist
// because create_payout_statement refuses a second draft for the SAME host
// while one is open — proving two DIFFERENT statements land on consecutive
// numbers, whether sequentially inside one probe (section 9) or under real
// overlapping connections (section 11), needs two hosts.
//
// ⚠️ ISSUING MUST NEVER COMMIT. A committed test issue would permanently
// occupy a gapless statement number with a fake payout, and the series can
// never reuse it. So every lifecycle call (draft, issue, cancel, reverse) runs
// inside a rolled-back SQL probe: a `do $$ … $$` block that ends by raising an
// exception carrying its result as JSON, so the whole transaction aborts and
// we parse the result out of the error text. The harness itself is proven
// (auth.uid() reflects the claimed uid; a sentinel insert provably does not
// survive) before any probe result is trusted, and the counter is re-read
// after the probes to prove no number was burned.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/082-payout-statements.mjs
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const execFileP = promisify(execFile)

// The hosted endpoint drops HTTP/2 sessions occasionally (GOAWAY) and the
// Supabase CLI intermittently fails to connect as its temp role. Both are
// transport noise, not results: retry them, but never retry a real Postgres
// error, or a refusal could be silently re-attempted into a pass.
// "Timeout while shutting down PostHog" is the CLI's own telemetry-flush
// timer racing its own exit — observed live in this script with valid JSON
// rows already on stdout and exit code 1 anyway. Transport noise, not a
// query failure; the sync sql() helper already re-parses stdout on retry.
const TRANSPORT_RE = /Failed to connect|ConnectTempRoleError|GOAWAY|ECONNRESET|socket hang up|fetch failed|Timeout while shutting down PostHog/i
const realFetch = globalThis.fetch
globalThis.fetch = async function retryingFetch(...args) {
  let last
  for (let i = 0; i < 4; i++) {
    try { return await realFetch(...args) } catch (e) {
      last = e
      if (!TRANSPORT_RE.test(`${e?.message} ${e?.cause?.message}`)) throw e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw last
}

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const LEGACY_REQUEST = 'a6194f2f-5599-4824-8e38-f4cc81af4d5f'
const PW = 'ProbeRentivo1'
const stamp = Date.now()
const created = { users: [], listings: [], bookings: [] }

// ── The rolled-back-probe helper (copied verbatim from 080) ────────────────
function sqlLit(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}
// Shared between the sync (execFileSync) and async (execFile/promisify)
// callers: parse the VERIFY payload out of the CLI's stdout/stderr.
function parseProbeError(rawStdout, rawStderr) {
  let payload = null
  try {
    const outer = JSON.parse(rawStdout)
    let msgText = outer?.error?.message ?? ''
    msgText = msgText.replace(/^unexpected status \d+: /, '')
    const inner = JSON.parse(msgText)
    const pgMsg = inner?.message ?? ''
    const m = pgMsg.match(/VERIFY ([\s\S]*?)(?:\nCONTEXT|$)/)
    payload = m ? m[1].trim() : null
  } catch {
    payload = null
  }
  return { raised: true, payload, error: `${rawStdout}${rawStderr}` }
}
function probeOnce(body) {
  try {
    execFileSync('supabase', ['db', 'query', '--linked', body], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { raised: false, payload: null, error: null }
  } catch (e) {
    return parseProbeError(e.stdout ?? '', e.stderr ?? '')
  }
}
function probe(sql, claims = null) {
  const preamble = claims
    ? `perform set_config('request.jwt.claims', ${sqlLit(JSON.stringify(claims))}, true);`
    : ''
  const body = `do $$\nbegin\n${preamble}\n${sql}\nend $$;`
  let r
  for (let i = 0; i < 4; i++) {
    r = probeOnce(body)
    // A transport failure is not a refusal. Retrying it is safe because the
    // probe rolls back either way; treating it as one would be a false pass.
    if (!(r.raised && TRANSPORT_RE.test(r.error ?? ''))) return r
  }
  return r
}
// Async twin, used ONLY for the concurrent-issue check (section 11) — it
// needs two genuinely overlapping `supabase db query` processes (two real
// Postgres connections), which execFileSync's blocking call cannot give us.
async function probeOnceAsync(body) {
  try {
    await execFileP('supabase', ['db', 'query', '--linked', body], { encoding: 'utf8' })
    return { raised: false, payload: null, error: null }
  } catch (e) {
    return parseProbeError(e.stdout ?? '', e.stderr ?? '')
  }
}
async function probeAsync(sql, claims = null) {
  const preamble = claims
    ? `perform set_config('request.jwt.claims', ${sqlLit(JSON.stringify(claims))}, true);`
    : ''
  const body = `do $$\nbegin\n${preamble}\n${sql}\nend $$;`
  let r
  for (let i = 0; i < 4; i++) {
    r = await probeOnceAsync(body)
    if (!(r.raised && TRANSPORT_RE.test(r.error ?? ''))) return r
  }
  return r
}
const sql = (q) => {
  let last
  for (let i = 0; i < 4; i++) {
    try {
      return JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).rows
    } catch (e) {
      last = e
      if (!TRANSPORT_RE.test(`${e.stdout ?? ''}${e.stderr ?? ''}${e.message}`)) throw e
    }
  }
  throw last
}
const json = (r) => { try { return JSON.parse(r.payload) } catch { return null } }

async function createUser(label) {
  const email = `probe-082-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  const token = await signIn(email, PW)
  return { id: j.id, token, email }
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
async function rpcService(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const msg = (r) => JSON.stringify(r.body ?? '')

// ── Baselines ─────────────────────────────────────────────────────────────
const counts = () => sql(`
  select (select count(*) from public.bookings)::int                    as bookings,
         (select count(*) from public.listings)::int                    as listings,
         (select count(*) from public.profiles)::int                    as profiles,
         (select count(*) from public.payout_requests)::int             as payout_requests,
         (select count(*) from public.payout_items)::int                as payout_items,
         (select count(*) from public.payout_accounts)::int             as payout_accounts,
         (select count(*) from public.admin_actions)::int               as admin_actions,
         (select count(*) from public.notifications)::int               as notifications,
         (select count(*) from public.conversations)::int               as conversations,
         (select count(*) from public.payout_statement_counters)::int   as counters
`)[0]
// Another agent is working against this same production database in parallel,
// so a bare count diff can be someone else's churn. Capture ID SETS too, and
// on a mismatch report which rows actually moved so it can be attributed
// rather than hand-waved.
const idsOf = (table, col = 'id') => new Set(sql(`select ${col}::text as v from public.${table}`).map((r) => r.v))
const idTables = [['profiles'], ['listings'], ['bookings'], ['payout_requests'], ['payout_accounts'], ['admin_actions']]
const idsBefore = Object.fromEntries(idTables.map(([t, c]) => [t, idsOf(t, c)]))
const before = counts()
const fBefore = sql(`
  select (select updated_at::text from public.profiles where id = '${FORBIDDEN_HOST}') as host_updated,
         (select updated_at::text from public.bookings where booking_ref = '${FORBIDDEN_BOOKING_REF}') as booking_updated,
         (select status::text from public.bookings where booking_ref = '${FORBIDDEN_BOOKING_REF}') as booking_status
`)[0]

async function cleanup() {
  for (const b of created.bookings) {
    await admin(`payout_items?booking_id=eq.${b}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${b}`, { method: 'DELETE' })
  }
  for (const u of created.users) {
    await admin(`payout_requests?host_id=eq.${u}`, { method: 'DELETE' })
    await admin(`payout_accounts?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`rate_limit_hits?key=like.*${u}*`, { method: 'DELETE' })
  }
  for (const l of created.listings) {
    await admin(`availability_blocks?listing_id=eq.${l}`, { method: 'DELETE' })
    await admin(`listings?id=eq.${l}`, { method: 'DELETE' })
  }
  for (const u of created.users) {
    await admin(`admin_actions?target_user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
  }
}
async function proveCleanup() {
  const detail = []
  for (const b of created.bookings) {
    if ((await admin(`bookings?select=id&id=eq.${b}`)).body.length) detail.push(`booking:${b}`)
  }
  for (const l of created.listings) {
    if ((await admin(`listings?select=id&id=eq.${l}`)).body.length) detail.push(`listing:${l}`)
  }
  for (const u of created.users) {
    for (const [t, q] of [
      ['profiles', `profiles?select=id&id=eq.${u}`],
      ['payout_accounts', `payout_accounts?select=id&user_id=eq.${u}`],
      ['payout_requests', `payout_requests?select=id&host_id=eq.${u}`],
      ['notifications', `notifications?select=id&user_id=eq.${u}`],
      ['conversations', `conversations?select=id&or=(renter_id.eq.${u},host_id.eq.${u})`],
      ['rate_limit_hits', `rate_limit_hits?select=key&key=like.*${u}*`],
      ['admin_actions', `admin_actions?select=id&target_user_id=eq.${u}`],
    ]) {
      const n = (await admin(q)).body.length
      if (n) detail.push(`${t}:${n}`)
    }
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
    if (r.status !== 404) detail.push(`auth:${r.status}`)
  }
  return detail
}

let HOST, RENTER, LISTING_ID
const BK = {}

try {
  // ── Setup: a throwaway host with three otherwise-identical completed+paid
  //    bookings that differ ONLY in payment_method, plus a verified account ──
  HOST = await createUser('host')
  RENTER = await createUser('renter')

  const { body: listingRows, status: listingStatus } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: HOST.id, category: 'lens', brand: 'Probe', model: '082',
      title: 'Probe 082 Lens', daily_price: 1000, city: 'Manila', province: 'Metro Manila',
      latitude: 14.5995, longitude: 120.9842, is_active: true, is_draft: false,
    }),
  })
  if (!listingRows?.[0]?.id) throw new Error(`listing insert failed: ${listingStatus} ${JSON.stringify(listingRows)}`)
  LISTING_ID = listingRows[0].id
  created.listings.push(LISTING_ID)

  async function makeBooking(label, method, rental, delivery, pickup, ret) {
    const { body, status } = await admin('bookings', {
      method: 'POST',
      body: JSON.stringify({
        listing_id: LISTING_ID, renter_id: RENTER.id, host_id: HOST.id,
        // total_days is a GENERATED column — inserting it is a 428C9.
        pickup_date: pickup, return_date: ret,
        rental_fee: rental, security_deposit: 0, service_fee: Math.round(rental * 0.05),
        protection_fee: 0, delivery_fee: delivery,
        total_amount: rental + Math.round(rental * 0.05) + delivery,
        status: 'completed', payment_status: 'paid',
        // host_qr cannot be INSERTed (block_host_qr_bookings, 072) — it is set
        // by a service-role UPDATE below, which that trigger does not cover.
        payment_method: method === 'host_qr' ? 'qrph' : method,
        service_fee_bps: 500,
      }),
    })
    if (!body?.[0]?.id) throw new Error(`booking insert failed (${label}): ${status} ${JSON.stringify(body)}`)
    created.bookings.push(body[0].id)
    if (method === 'host_qr') {
      sql(`update public.bookings set payment_method = 'host_qr' where id = '${body[0].id}'`)
    }
    BK[label] = { id: body[0].id, ref: body[0].booking_ref, payable: rental + delivery }
  }
  await makeBooking('qrph', 'qrph', 7777, 123, '2026-08-01', '2026-08-03')
  await makeBooking('hostqr', 'host_qr', 1111, 0, '2026-08-05', '2026-08-07')
  await makeBooking('testskip', 'test_skip', 2222, 0, '2026-08-09', '2026-08-11')

  const { body: acctRows } = await admin('payout_accounts', {
    method: 'POST',
    body: JSON.stringify({
      user_id: HOST.id, method: 'GCash', account_number: '09990000082',
      account_name: 'Probe 082 Host', status: 'verified',
    }),
  })
  if (!acctRows?.[0]?.id) throw new Error('payout_account insert failed')

  // A second, independent throwaway host + eligible booking + verified
  // account — used for two things a single host cannot demonstrate: (a) two
  // DIFFERENT statements issued inside one probe get consecutive numbers
  // (create_payout_statement refuses a second draft for the SAME host while
  // one is open, so proving "consecutive" needs two hosts), and (b) the
  // concurrent-issue check, which needs two real overlapping connections
  // touching the same counter row without either one waiting on the other's
  // own per-host draft lock.
  const HOSTF = await createUser('hostf')
  const { body: fBookingRows, status: fBookingStatus } = await admin('bookings', {
    method: 'POST',
    body: JSON.stringify({
      listing_id: LISTING_ID, renter_id: RENTER.id, host_id: HOSTF.id,
      pickup_date: '2026-08-15', return_date: '2026-08-17',
      rental_fee: 3200, security_deposit: 0, service_fee: Math.round(3200 * 0.05),
      protection_fee: 0, delivery_fee: 0, total_amount: 3200 + Math.round(3200 * 0.05),
      status: 'completed', payment_status: 'paid', payment_method: 'qrph', service_fee_bps: 500,
    }),
  })
  if (!fBookingRows?.[0]?.id) throw new Error(`hostf booking insert failed: ${fBookingStatus} ${JSON.stringify(fBookingRows)}`)
  created.bookings.push(fBookingRows[0].id)
  const { body: fAcctRows } = await admin('payout_accounts', {
    method: 'POST',
    body: JSON.stringify({
      user_id: HOSTF.id, method: 'Maya', account_number: '09990000083',
      account_name: 'Probe 082 Host F', status: 'verified',
    }),
  })
  if (!fAcctRows?.[0]?.id) throw new Error('hostf payout_account insert failed')

  const H = HOST.id
  const HF = HOSTF.id
  const EXPECTED = BK.qrph.payable // 7900
  const EXPECTED_F = 3200

  // ── 1. Prove the harness before trusting any probe result ────────────────
  {
    const uid = '11111111-1111-1111-1111-111111111111'
    const r = probe("raise exception 'VERIFY %', auth.uid();", { sub: uid, role: 'authenticated' })
    check('1. harness: auth.uid() inside a probe equals the claimed uid', r.raised && r.payload === uid, `${r.payload}`)

    const r2 = probe(`insert into public.admin_actions (admin_email, action, target_user_id, detail) values ('probe-082@example.com','probe_082_rollback_sentinel',null,'{}'::jsonb); raise exception 'VERIFY %', 'sentinel-inserted';`)
    check('1. harness: sentinel-insert probe raises as expected', r2.raised && r2.payload === 'sentinel-inserted', `${r2.payload}`)
    const survived = (await admin('admin_actions?select=id&action=eq.probe_082_rollback_sentinel')).body
    check('1. harness: the sentinel row does NOT survive — the probe truly rolled back', survived.length === 0, `${survived.length} rows found`)
  }

  // ── 2. The legacy row, backfilled ────────────────────────────────────────
  {
    const [row] = sql(`select statement_number, status::text as status, amount, reference, transferred_on::text as transferred_on,
                              account_method::text as account_method, account_name, account_number
                       from public.payout_requests where id = '${LEGACY_REQUEST}'`)
    check('2. legacy request numbered PS-2026-000001', row.statement_number === 'PS-2026-000001', `${row.statement_number}`)
    check('2. legacy request account snapshot copied from payout_accounts (GCash / Demo Host QA / 09171234567)',
      row.account_method === 'GCash' && row.account_name === 'Demo Host QA' && row.account_number === '09171234567',
      `${row.account_method}/${row.account_name}/${row.account_number}`)
    check('2. legacy request transferred_on = processed_at in Manila (2026-09-01)', row.transferred_on === '2026-09-01', `${row.transferred_on}`)
    check('2. legacy request keeps its reference and paid status', row.status === 'paid' && row.reference === 'QA-GCASH-REF-001', `${row.status}/${row.reference}`)

    const [sum] = sql(`select pr.amount as req, coalesce(sum(pi.amount),0)::int as items, count(pi.*)::int as n
                       from public.payout_requests pr left join public.payout_items pi on pi.payout_request_id = pr.id
                       where pr.id = '${LEGACY_REQUEST}' group by pr.amount`)
    check('2. legacy request amount = sum of its items', sum.req === sum.items && sum.n === 1, `amount=${sum.req} items=${sum.items} n=${sum.n}`)

    const [item] = sql(`select booking_ref, listing_title, pickup_date::text as pickup_date, return_date::text as return_date,
                               rental_fee, delivery_fee, service_fee, service_fee_bps, amount
                        from public.payout_items where payout_request_id = '${LEGACY_REQUEST}'`)
    check('2. legacy item snapshot matches its booking (RNT-678020 / Refund Test Lens A / 1200+0 / 144 @ 1200bps)',
      item.booking_ref === 'RNT-678020' && item.listing_title === 'Refund Test Lens A' &&
      item.rental_fee === 1200 && item.delivery_fee === 0 && item.service_fee === 144 && item.service_fee_bps === 1200 &&
      item.amount === 1200,
      JSON.stringify(item))

    const [ctr] = sql('select year, last_number from public.payout_statement_counters')
    check('2. counter seeded to (2026, 1) so the next real statement is PS-2026-000002',
      ctr.year === 2026 && ctr.last_number === 1, JSON.stringify(ctr))
    const nctr = sql('select count(*)::int as n from public.payout_statement_counters')[0].n
    check('2. exactly one counter row exists', nctr === 1, `${nctr}`)

    // Snapshots are a document, not a view: renaming the listing must not move
    // the statement. Proven inside a probe so the real title is never changed.
    const r = probe(`
      declare v_title text; v_item text;
      begin
        update public.listings set title = 'RENAMED IN PROBE'
          where id = (select listing_id from public.bookings where booking_ref = 'RNT-678020');
        select title into v_title from public.listings
          where id = (select listing_id from public.bookings where booking_ref = 'RNT-678020');
        select listing_title into v_item from public.payout_items where payout_request_id = '${LEGACY_REQUEST}';
        raise exception 'VERIFY %', jsonb_build_object('listing', v_title, 'item', v_item);
      end;`)
    const p = json(r)
    check('2. CONTROL (rolled back): renaming the listing changes the LISTING but not the statement snapshot',
      p?.listing === 'RENAMED IN PROBE' && p?.item === 'Refund Test Lens A', JSON.stringify(p))
  }

  // ── 3. Invariants refuse a malformed row, with controls ──────────────────
  {
    const cases = [
      { label: 'a paid request with no statement_number -> payout_requests_paid_complete',
        sql: `update public.payout_requests set statement_number = null where id = '${LEGACY_REQUEST}';`,
        re: /payout_requests_paid_complete/ },
      { label: 'a paid request with no transferred_on -> payout_requests_paid_complete',
        sql: `update public.payout_requests set transferred_on = null where id = '${LEGACY_REQUEST}';`,
        re: /payout_requests_paid_complete/ },
      // Two invariants overlap on this shape (pending_unnumbered AND
      // number_only_when_issued are both violated) and Postgres reports
      // whichever it evaluates first — observed: number_only_when_issued.
      // Accept either: the claim under test is that the row is refused, and
      // "a draft is unnumbered" is separately proven functionally by check 8's
      // control, where a real draft comes back with statement_number null.
      { label: 'a pending request carrying a number -> refused (pending_unnumbered / number_only_when_issued)',
        sql: `update public.payout_requests set status = 'pending' where id = '${LEGACY_REQUEST}';`,
        re: /payout_requests_(pending_unnumbered|number_only_when_issued)/ },
      { label: 'reversed_at set while still paid -> payout_requests_reversal_shape',
        sql: `update public.payout_requests set reversed_at = now(), reversal_reason = 'x' where id = '${LEGACY_REQUEST}';`,
        re: /payout_requests_reversal_shape/ },
      { label: "a badly formatted number ('PS-26-1') -> the format CHECK",
        sql: `update public.payout_requests set statement_number = 'PS-26-1' where id = '${LEGACY_REQUEST}';`,
        re: /payout_requests_statement_number_check/ },
      { label: 'a payout_item whose amount <> rental_fee + delivery_fee -> payout_items_amount_matches',
        sql: `update public.payout_items set rental_fee = 1 where payout_request_id = '${LEGACY_REQUEST}';`,
        re: /payout_items_amount_matches/ },
    ]
    for (const c of cases) {
      const r = probe(c.sql + " raise exception 'VERIFY unreached';")
      check(`3. ${c.label}`, r.raised && c.re.test(r.error ?? ''), `${(r.error ?? '').slice(0, 220)}`)
    }
    // CONTROL: a legal edit of the same rows in the same shape succeeds, so
    // each refusal above is attributable to its own constraint, not to a
    // blanket write block on these tables at the postgres level.
    const ctrl = probe(`
      declare v_n text;
      begin
        update public.payout_requests set reference = 'PROBE-CTRL' where id = '${LEGACY_REQUEST}';
        update public.payout_items set listing_title = 'PROBE-CTRL' where payout_request_id = '${LEGACY_REQUEST}';
        select reference into v_n from public.payout_requests where id = '${LEGACY_REQUEST}';
        raise exception 'VERIFY %', v_n;
      end;`)
    check('3. CONTROL (rolled back): a legal edit of the same two rows succeeds', ctrl.raised && ctrl.payload === 'PROBE-CTRL', `${ctrl.payload}`)
    const [after] = sql(`select statement_number, reference, status::text as status from public.payout_requests where id = '${LEGACY_REQUEST}'`)
    check('3. after all constraint probes the legacy row is untouched',
      after.statement_number === 'PS-2026-000001' && after.reference === 'QA-GCASH-REF-001' && after.status === 'paid', JSON.stringify(after))
  }

  // ── 4. Table grants and RLS ──────────────────────────────────────────────
  {
    const g = sql(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
                   from information_schema.role_table_grants
                   where table_schema = 'public'
                     and table_name in ('payout_accounts','payout_requests','payout_items','payout_statement_counters')
                     and grantee in ('anon','authenticated','service_role')
                   group by 1,2`)
    for (const t of ['payout_accounts', 'payout_requests', 'payout_items']) {
      for (const role of ['anon', 'authenticated']) {
        const row = g.find((x) => x.table_name === t && x.grantee === role)
        check(`4. ${role} holds SELECT only on ${t} (INSERT/UPDATE/DELETE revoked)`, row?.privs === 'SELECT', `${row?.privs ?? 'none'}`)
      }
    }
    const ctrAnon = g.find((x) => x.table_name === 'payout_statement_counters' && x.grantee === 'anon')
    const ctrAuth = g.find((x) => x.table_name === 'payout_statement_counters' && x.grantee === 'authenticated')
    const ctrSvc = g.find((x) => x.table_name === 'payout_statement_counters' && x.grantee === 'service_role')
    check('4. payout_statement_counters: anon holds nothing', !ctrAnon, `${ctrAnon?.privs}`)
    check('4. payout_statement_counters: authenticated holds nothing', !ctrAuth, `${ctrAuth?.privs}`)
    // service_role holds more than the migration's explicit `grant select`:
    // this project's bootstrap default ACL hands the trusted server role the
    // full arwd on every table `postgres` creates (079 revoked that default
    // only for anon/authenticated). Not a hole — service_role bypasses RLS
    // anyway — but the explicit grant is belt-and-braces, not the mechanism.
    check('4. payout_statement_counters: service_role holds SELECT', /(^|,)SELECT(,|$)/.test(ctrSvc?.privs ?? ''), `${ctrSvc?.privs}`)

    const [rls] = sql(`select c.relrowsecurity, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename='payout_statement_counters')::int as policies
                       from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname='public' and c.relname='payout_statement_counters'`)
    check('4. payout_statement_counters has RLS enabled in its creating migration', rls.relrowsecurity === true, `${rls.relrowsecurity}`)
    check('4. payout_statement_counters has no policies (default-deny)', rls.policies === 0, `${rls.policies}`)

    // Live, with a real signed-in session — not a catalog reading.
    const ins = await asUser(HOST.token, 'payout_requests', {
      method: 'POST',
      body: JSON.stringify({ host_id: H, payout_account_id: LEGACY_REQUEST, amount: 1 }),
    })
    check('4. the host INSERTing a payout_requests row -> permission denied (privilege, not RLS)',
      /permission denied for table payout_requests/.test(msg(ins)), `${ins.status} ${msg(ins)}`)
    const upd = await asUser(HOST.token, `payout_requests?id=eq.${LEGACY_REQUEST}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 1 }),
    })
    check('4. the host UPDATEing a payout_requests row -> permission denied',
      /permission denied for table payout_requests/.test(msg(upd)), `${upd.status} ${msg(upd)}`)
    const del = await asUser(HOST.token, `payout_items?payout_request_id=eq.${LEGACY_REQUEST}`, { method: 'DELETE' })
    check('4. the host DELETEing a payout_items row -> permission denied',
      /permission denied for table payout_items/.test(msg(del)), `${del.status} ${msg(del)}`)
    const insAcct = await asUser(HOST.token, 'payout_accounts', {
      method: 'POST', body: JSON.stringify({ user_id: H, method: 'GCash', account_number: 'x', account_name: 'x' }),
    })
    check('4. the host INSERTing a payout_accounts row -> permission denied',
      /permission denied for table payout_accounts/.test(msg(insAcct)), `${insAcct.status} ${msg(insAcct)}`)
    // CONTROL: the same session still READS its own rows, so the refusals
    // above are the write revoke, not a broken session or a blanket block.
    const readAcct = await asUser(HOST.token, 'payout_accounts?select=account_name,status')
    check('4. CONTROL: the same host session still SELECTs its own payout_accounts row',
      readAcct.status === 200 && readAcct.body?.[0]?.account_name === 'Probe 082 Host', `${readAcct.status} ${msg(readAcct)}`)
    const readReq = await asUser(HOST.token, 'payout_requests?select=id')
    check('4. CONTROL: the same host session still SELECTs payout_requests (own rows: none yet)',
      readReq.status === 200 && Array.isArray(readReq.body) && readReq.body.length === 0, `${readReq.status} ${msg(readReq)}`)

    const ctrRead = await asUser(HOST.token, 'payout_statement_counters?select=*')
    check('4. the host reading payout_statement_counters -> refused', ctrRead.status !== 200, `${ctrRead.status} ${msg(ctrRead)}`)
    const ctrAnonRead = await asUser(null, 'payout_statement_counters?select=*')
    check('4. anon reading payout_statement_counters -> refused', ctrAnonRead.status !== 200, `${ctrAnonRead.status} ${msg(ctrAnonRead)}`)

    // Anon (no bearer token — the anon key itself, role 'anon') holds the
    // same SELECT-only grant as authenticated, so its writes are refused the
    // identical way, not merely by a missing session.
    const insAnon = await asUser(null, 'payout_requests', {
      method: 'POST',
      body: JSON.stringify({ host_id: H, payout_account_id: LEGACY_REQUEST, amount: 1 }),
    })
    check('4. anon INSERTing a payout_requests row -> permission denied',
      /permission denied for table payout_requests/.test(msg(insAnon)), `${insAnon.status} ${msg(insAnon)}`)
    const updAnon = await asUser(null, `payout_requests?id=eq.${LEGACY_REQUEST}`, {
      method: 'PATCH', body: JSON.stringify({ amount: 1 }),
    })
    check('4. anon UPDATEing a payout_requests row -> permission denied',
      /permission denied for table payout_requests/.test(msg(updAnon)), `${updAnon.status} ${msg(updAnon)}`)
    const delAnon = await asUser(null, `payout_items?payout_request_id=eq.${LEGACY_REQUEST}`, { method: 'DELETE' })
    check('4. anon DELETEing a payout_items row -> permission denied',
      /permission denied for table payout_items/.test(msg(delAnon)), `${delAnon.status} ${msg(delAnon)}`)
    const insAcctAnon = await asUser(null, 'payout_accounts', {
      method: 'POST', body: JSON.stringify({ user_id: H, method: 'GCash', account_number: 'x', account_name: 'x' }),
    })
    check('4. anon INSERTing a payout_accounts row -> permission denied',
      /permission denied for table payout_accounts/.test(msg(insAcctAnon)), `${insAcctAnon.status} ${msg(insAcctAnon)}`)
    // CONTROL 1: anon still SELECTs (the grant is SELECT-only) — RLS scopes
    // the ROWS (own-read policies, uid null matches nothing), not the
    // privilege, so this is 200 + empty, never a permission error.
    const anonReqRead = await asUser(null, 'payout_requests?select=id')
    check('4. CONTROL: anon SELECT on payout_requests -> 200 with zero rows (SELECT granted, RLS scopes rows to nobody)',
      anonReqRead.status === 200 && Array.isArray(anonReqRead.body) && anonReqRead.body.length === 0,
      `${anonReqRead.status} ${msg(anonReqRead)}`)
    // CONTROL 2: an unrelated, genuinely anon-granted RPC still works with
    // the exact same anon key — the refusals above are these specific
    // tables' grants, not a broken key or a blanket deny-all.
    const anonRpc = await rpcAnon(null, 'current_service_fee_bps', {})
    check('4. CONTROL: anon calling an unrelated, actually anon-granted RPC (current_service_fee_bps) still succeeds',
      anonRpc.status === 200 && typeof anonRpc.body === 'number', `${anonRpc.status} ${msg(anonRpc)}`)
  }

  // ── 5. Function grants ───────────────────────────────────────────────────
  {
    const fns = [
      // ⚠️ service_role = true is NOT what the "internal, no client grant"
      // label suggests, and is worth knowing: 082 revokes EXECUTE from
      // public/anon/authenticated (the sessions the null-host-id hazard is
      // about), but this project's DEFAULT function privileges also grant
      // EXECUTE to service_role, and the migration does not revoke that.
      // It discloses nothing new — payouts_owed(null) is deliberately
      // service_role-granted and returns the same platform-wide figure from
      // the same rows — and service_role bypasses RLS anyway. Recorded rather
      // than "fixed", because the grant list is the plan's verbatim text and
      // narrowing it is a decision for C2/C7, not a silent edit here.
      ['payout_eligible_bookings(uuid)', { anon: false, authenticated: false, service_role: true }],
      ['payouts_owed(uuid)', { anon: false, authenticated: false, service_role: true }],
      ['my_payout_balance()', { anon: false, authenticated: true, service_role: true }],
      ['create_payout_statement(uuid,integer,text)', { anon: false, authenticated: false, service_role: true }],
      ['issue_payout_statement(uuid,text,date,text)', { anon: false, authenticated: false, service_role: true }],
      ['cancel_payout_statement(uuid,text,text)', { anon: false, authenticated: false, service_role: true }],
      ['reverse_payout_statement(uuid,text,text)', { anon: false, authenticated: false, service_role: true }],
    ]
    for (const [sig, want] of fns) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const got = sql(`select has_function_privilege('${role}', 'public.${sig}', 'EXECUTE') as ok`)[0].ok
        check(`5. ${sig}: ${role} EXECUTE = ${want[role]}`, got === want[role], `got ${got}`)
      }
    }
    // PUBLIC must hold nothing — function defaults grant EXECUTE to PUBLIC in
    // this project, so a missing revoke is an anonymous-callable function.
    for (const [sig] of fns) {
      const acl = sql(`select coalesce(p.proacl::text, 'NULL') as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.oid = 'public.${sig}'::regprocedure`)[0].acl
      check(`5. ${sig}: no bare "=X/" PUBLIC grant in the ACL`, !/[{,]=X\//.test(acl) && acl !== 'NULL', acl)
    }
  }

  // ── 6. The RPCs, live over PostgREST ─────────────────────────────────────
  {
    const eligHost = await rpcAnon(HOST.token, 'payout_eligible_bookings', { p_host_id: H })
    check('6. the host calling payout_eligible_bookings -> refused (internal, no client grant)', eligHost.status !== 200, `${eligHost.status} ${msg(eligHost)}`)
    const eligAnon = await rpcAnon(null, 'payout_eligible_bookings', { p_host_id: H })
    check('6. anon calling payout_eligible_bookings -> refused', eligAnon.status !== 200, `${eligAnon.status} ${msg(eligAnon)}`)
    // The service role CAN call it — see the grant note in section 5. Asserted
    // as observed rather than as hoped, and paired with the check that the
    // data it exposes is the same data payouts_owed already gives that role.
    const eligSvc = await rpcService('payout_eligible_bookings', { p_host_id: H })
    check('6. the service role CAN call payout_eligible_bookings (default function privilege, not revoked by 082)',
      eligSvc.status === 200, `${eligSvc.status} ${msg(eligSvc)}`)
    // CONTROL: it works for its owner, so the refusals are the grant list and
    // not a broken function.
    const ownerRows = sql(`select booking_id::text, payable from public.payout_eligible_bookings('${H}')`)
    check('6. CONTROL: the same function called as its owner returns rows', ownerRows.length === 1, `${ownerRows.length}`)

    const owedHost = await rpcAnon(HOST.token, 'payouts_owed', { p_host_id: H })
    check('6. the host calling payouts_owed -> refused (service_role only)', owedHost.status !== 200, `${owedHost.status} ${msg(owedHost)}`)
    const owedAnon = await rpcAnon(null, 'payouts_owed', { p_host_id: H })
    check('6. anon calling payouts_owed -> refused', owedAnon.status !== 200, `${owedAnon.status} ${msg(owedAnon)}`)
    const owedSvc = await rpcService('payouts_owed', { p_host_id: H })
    check('6. CONTROL: the service role calling payouts_owed returns the probe host\'s figure (1 booking, ₱7,900)',
      owedSvc.status === 200 && owedSvc.body?.[0]?.bookings === 1 && owedSvc.body?.[0]?.amount === EXPECTED,
      `${owedSvc.status} ${msg(owedSvc)}`)

    const balHost = await rpcAnon(HOST.token, 'my_payout_balance', {})
    check('6. the host calling my_payout_balance gets THEIR OWN figure (1 booking, ₱7,900)',
      balHost.status === 200 && balHost.body?.[0]?.bookings === 1 && balHost.body?.[0]?.amount === EXPECTED,
      `${balHost.status} ${msg(balHost)}`)
    const balRenter = await rpcAnon(RENTER.token, 'my_payout_balance', {})
    check('6. CONTROL: a different signed-in user gets THEIR figure (0, ₱0) — the answer is scoped to auth.uid()',
      balRenter.status === 200 && balRenter.body?.[0]?.bookings === 0 && balRenter.body?.[0]?.amount === 0,
      `${balRenter.status} ${msg(balRenter)}`)
    const balAnon = await rpcAnon(null, 'my_payout_balance', {})
    check('6. anon calling my_payout_balance -> refused (no EXECUTE grant)', balAnon.status !== 200, `${balAnon.status} ${msg(balAnon)}`)
    // The load-bearing guard: a null auth.uid() must RAISE, not fall through
    // to payout_eligible_bookings(null) and return the platform-wide balance.
    const balSvc = await rpcService('my_payout_balance', {})
    check('6. ⚠️ my_payout_balance with a null auth.uid() raises "Not authenticated." rather than returning the platform-wide balance',
      balSvc.status !== 200 && /Not authenticated/.test(msg(balSvc)), `${balSvc.status} ${msg(balSvc)}`)
    const platformWide = sql('select coalesce(sum(payable),0)::int as amount from public.payout_eligible_bookings(null)')[0].amount
    check('6. (context) the platform-wide balance the guard withholds is genuinely larger than the host\'s own',
      platformWide > EXPECTED, `platform=${platformWide} host=${EXPECTED}`)
  }

  // ── 7. Eligibility: the host_qr / test_skip exclusions, with controls ────
  {
    const rows = sql(`select b.booking_ref, b.payment_method::text as pm
                      from public.payout_eligible_bookings('${H}') e join public.bookings b on b.id = e.booking_id`)
    check('7. only the qrph booking is eligible for the probe host',
      rows.length === 1 && rows[0].pm === 'qrph' && rows[0].booking_ref === BK.qrph.ref,
      JSON.stringify(rows))

    // The control that makes the exclusion attributable: the two excluded
    // bookings are identical to the included one on EVERY other predicate.
    const others = sql(`select booking_ref, payment_method::text as pm, status::text as status, payment_status::text as ps,
                               (return_date <= (now() at time zone 'Asia/Manila')::date) as past_return,
                               not exists (select 1 from public.payout_items pi join public.payout_requests pr on pr.id = pi.payout_request_id
                                           where pi.booking_id = bookings.id and pr.status in ('pending','paid')) as unclaimed
                        from public.bookings where id in ('${BK.hostqr.id}','${BK.testskip.id}')`)
    check('7. CONTROL: both excluded bookings are completed + paid + past return + unclaimed — only payment_method differs',
      others.length === 2 && others.every((o) => o.status === 'completed' && o.ps === 'paid' && o.past_return === true && o.unclaimed === true),
      JSON.stringify(others))

    // The decisive control: flip payment_method inside a probe and the same
    // booking becomes eligible. Rolled back, so the row never really changes.
    for (const [label, id] of [['host_qr', BK.hostqr.id], ['test_skip', BK.testskip.id]]) {
      const r = probe(`
        declare v_n int;
        begin
          update public.bookings set payment_method = 'qrph' where id = '${id}';
          select count(*)::int into v_n from public.payout_eligible_bookings('${H}') where booking_id = '${id}';
          raise exception 'VERIFY %', v_n;
        end;`)
      check(`7. CONTROL (rolled back): the ${label} booking becomes eligible the moment its payment_method is qrph`,
        r.raised && r.payload === '1', `${r.payload} ${(r.error ?? '').slice(0, 160)}`)
    }
    const stillExcluded = sql(`select payment_method::text as pm from public.bookings where id = '${BK.hostqr.id}'`)[0].pm
    check('7. after the rolled-back control the host_qr booking is still host_qr', stillExcluded === 'host_qr', `${stillExcluded}`)
  }

  // ── 8. Lifecycle refusals — every one inside a rolled-back probe ─────────
  const E = "'admin@example.com'"
  {
    const draftCases = [
      { label: 'blank admin email', sql: `perform public.create_payout_statement('${H}', ${EXPECTED}, '   ');`, re: /An admin email is required/ },
      { label: 'null host', sql: `perform public.create_payout_statement(null, ${EXPECTED}, ${E});`, re: /A host is required/ },
      { label: 'zero expected amount', sql: `perform public.create_payout_statement('${H}', 0, ${E});`, re: /An expected amount is required/ },
      { label: 'null expected amount', sql: `perform public.create_payout_statement('${H}', null, ${E});`, re: /An expected amount is required/ },
      { label: 'unknown host', sql: `perform public.create_payout_statement('00000000-0000-4000-8000-000000000000', ${EXPECTED}, ${E});`, re: /Host not found/ },
      { label: 'suspended host', sql: `update public.profiles set suspended_at = now() where id = '${H}'; perform public.create_payout_statement('${H}', ${EXPECTED}, ${E});`, re: /Payouts are on hold/ },
      { label: 'payout account not verified', sql: `update public.payout_accounts set status = 'pending' where user_id = '${H}'; perform public.create_payout_statement('${H}', ${EXPECTED}, ${E});`, re: /no verified payout account/ },
      { label: 'host with no payout account at all', sql: `perform public.create_payout_statement('${RENTER.id}', ${EXPECTED}, ${E});`, re: /no verified payout account/ },
      { label: 'expected amount disagrees with what is owed', sql: `perform public.create_payout_statement('${H}', ${EXPECTED - 1}, ${E});`, re: new RegExp(`amount owed changed from ${EXPECTED - 1} to ${EXPECTED}`) },
      { label: 'a second draft while one is open', sql: `perform public.create_payout_statement('${H}', ${EXPECTED}, ${E}); perform public.create_payout_statement('${H}', ${EXPECTED}, ${E});`, re: /already has a draft payout statement/ },
      { label: 'a host with a verified account but nothing owed', sql: `insert into public.payout_accounts (user_id, method, account_number, account_name, status) values ('${RENTER.id}','GCash','0999','Probe Renter','verified'); perform public.create_payout_statement('${RENTER.id}', 1, ${E});`, re: /nothing owed right now/ },
    ]
    for (const c of draftCases) {
      const r = probe(c.sql + " raise exception 'VERIFY unreached';")
      check(`8. draft refused: ${c.label}`, r.raised && c.re.test(r.error ?? ''), `${(r.error ?? '').slice(0, 220)}`)
    }

    // CONTROL: the correct call succeeds, snapshots, sums and audits — the
    // single probe every refusal above is measured against.
    const ctrl = probe(`
      declare v_req public.payout_requests; v_item public.payout_items; v_audit int; v_elig int;
      begin
        select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E});
        select * into v_item from public.payout_items where payout_request_id = v_req.id;
        select count(*)::int into v_audit from public.admin_actions
          where action = 'payout_statement_draft' and target_user_id = '${H}';
        select count(*)::int into v_elig from public.payout_eligible_bookings('${H}');
        raise exception 'VERIFY %', jsonb_build_object(
          'status', v_req.status, 'amount', v_req.amount, 'number', v_req.statement_number,
          'acct_method', v_req.account_method, 'acct_name', v_req.account_name, 'acct_number', v_req.account_number,
          'item_ref', v_item.booking_ref, 'item_title', v_item.listing_title, 'item_amount', v_item.amount,
          'item_rental', v_item.rental_fee, 'item_delivery', v_item.delivery_fee,
          'item_service', v_item.service_fee, 'item_bps', v_item.service_fee_bps,
          'audit', v_audit, 'still_eligible', v_elig);
      end;`)
    const p = json(ctrl)
    check('8. CONTROL (rolled back): a valid draft is pending, unnumbered, and priced at ₱7,900',
      p?.status === 'pending' && p?.amount === EXPECTED && p?.number === null, JSON.stringify(p))
    check('8. CONTROL: the draft snapshots the payout account onto itself (GCash / Probe 082 Host / 09990000082)',
      p?.acct_method === 'GCash' && p?.acct_name === 'Probe 082 Host' && p?.acct_number === '09990000082', JSON.stringify(p))
    check('8. CONTROL: the item snapshots the booking (ref, title, 7777 + 123 = 7900, fee @ 500bps)',
      p?.item_ref === BK.qrph.ref && p?.item_title === 'Probe 082 Lens' && p?.item_amount === EXPECTED &&
      p?.item_rental === 7777 && p?.item_delivery === 123 && p?.item_bps === 500, JSON.stringify(p))
    check('8. CONTROL: the draft writes one payout_statement_draft admin_actions row', p?.audit === 1, `${p?.audit}`)
    check('8. CONTROL: the drafted booking is no longer eligible (a pending claim excludes it)', p?.still_eligible === 0, `${p?.still_eligible}`)
  }

  // ── 9. Issue — the numbered, gapless half. NOTHING here may commit ───────
  {
    const mkDraft = `declare v_req public.payout_requests; v_id uuid; begin select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E}); v_id := v_req.id;`
    const TODAY = "(now() at time zone 'Asia/Manila')::date"
    const issueCases = [
      { label: 'blank admin email', sql: `perform public.issue_payout_statement(v_id, 'REF-1', ${TODAY}, '  ');`, re: /An admin email is required/ },
      { label: 'blank reference', sql: `perform public.issue_payout_statement(v_id, '   ', ${TODAY}, ${E});`, re: /A transfer reference is required/ },
      { label: 'a 101-character reference', sql: `perform public.issue_payout_statement(v_id, repeat('x', 101), ${TODAY}, ${E});`, re: /100 characters or fewer/ },
      { label: 'an unknown statement id', sql: `perform public.issue_payout_statement('00000000-0000-4000-8000-000000000000', 'REF-1', ${TODAY}, ${E});`, re: /Payout statement not found/ },
      { label: 'a null transfer date', sql: `perform public.issue_payout_statement(v_id, 'REF-1', null, ${E});`, re: /A transfer date is required/ },
      { label: 'a transfer date in the future', sql: `perform public.issue_payout_statement(v_id, 'REF-1', ${TODAY} + 1, ${E});`, re: /cannot be in the future/ },
      { label: 'a transfer date before the draft was prepared', sql: `perform public.issue_payout_statement(v_id, 'REF-1', ${TODAY} - 1, ${E});`, re: /cannot be before the draft was prepared/ },
      { label: 'issuing a cancelled draft', sql: `perform public.cancel_payout_statement(v_id, 'nope', ${E}); perform public.issue_payout_statement(v_id, 'REF-1', ${TODAY}, ${E});`, re: /Only a draft can be issued/ },
      { label: 're-issuing with a DIFFERENT reference', sql: `perform public.issue_payout_statement(v_id, 'REF-1', ${TODAY}, ${E}); perform public.issue_payout_statement(v_id, 'REF-2', ${TODAY}, ${E});`, re: /already issued with reference REF-1/ },
    ]
    for (const c of issueCases) {
      const r = probe(`${mkDraft} ${c.sql} raise exception 'VERIFY unreached'; end;`)
      check(`9. issue refused: ${c.label}`, r.raised && c.re.test(r.error ?? ''), `${(r.error ?? '').slice(0, 220)}`)
    }

    const ctrl = probe(`
      declare v_req public.payout_requests; v_again public.payout_requests; v_id uuid; v_ctr int; v_audit int; v_elig int;
              v_req2 public.payout_requests; v_id2 uuid; v_ctr2 int; v_idem_ctr int;
      begin
        select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E});
        v_id := v_req.id;
        select * into v_req from public.issue_payout_statement(v_id, 'PROBE-REF-082', ${TODAY}, ${E});
        select last_number into v_ctr from public.payout_statement_counters where year = 2026;
        select * into v_again from public.issue_payout_statement(v_id, 'PROBE-REF-082', ${TODAY}, ${E});
        -- Captured HERE, right after the idempotent re-issue — NOT via a
        -- subquery inside the final jsonb_build_object below, which would
        -- lazily evaluate at raise-time and pick up HOST_F's later increment.
        select last_number into v_idem_ctr from public.payout_statement_counters where year = 2026;
        select count(*)::int into v_audit from public.admin_actions
          where action = 'payout_statement_issue' and target_user_id = '${H}';
        select count(*)::int into v_elig from public.payout_eligible_bookings('${H}');

        -- A SECOND, DIFFERENT host's draft, issued inside this same
        -- transaction. create_payout_statement refuses a second draft for
        -- the SAME host while one is open, so "consecutive numbers" can only
        -- be shown with two hosts — this is that proof, and it runs inside
        -- the same probe (no concurrency needed) because sequencing within
        -- one transaction is already deterministic.
        select * into v_req2 from public.create_payout_statement('${HF}', ${EXPECTED_F}, ${E});
        v_id2 := v_req2.id;
        select * into v_req2 from public.issue_payout_statement(v_id2, 'PROBE-REF-082-F', ${TODAY}, ${E});
        select last_number into v_ctr2 from public.payout_statement_counters where year = 2026;

        raise exception 'VERIFY %', jsonb_build_object(
          'number', v_req.statement_number, 'status', v_req.status, 'reference', v_req.reference,
          'transferred_on', v_req.transferred_on, 'processed', (v_req.processed_at is not null),
          'counter', v_ctr,
          'idem_number', v_again.statement_number, 'idem_counter', v_idem_ctr,
          'audit', v_audit, 'still_eligible', v_elig,
          'number2', v_req2.statement_number, 'status2', v_req2.status, 'counter2', v_ctr2);
      end;`)
    const p = json(ctrl)
    check('9. CONTROL (rolled back): issuing the draft assigns the next gapless number, PS-2026-000002',
      p?.number === 'PS-2026-000002' && p?.status === 'paid' && p?.reference === 'PROBE-REF-082', JSON.stringify(p))
    check('9. CONTROL: the counter advanced 1 -> 2 inside the same transaction', p?.counter === 2, `${p?.counter}`)
    check('9. CONTROL: issuing stamps transferred_on and processed_at', !!p?.transferred_on && p?.processed === true, JSON.stringify(p))
    check('9. CONTROL: re-issuing with the SAME reference is idempotent — same number, counter NOT advanced again',
      p?.idem_number === 'PS-2026-000002' && p?.idem_counter === 2, `${p?.idem_number} / ${p?.idem_counter}`)
    check('9. CONTROL: issuing writes one payout_statement_issue admin_actions row', p?.audit === 1, `${p?.audit}`)
    check('9. CONTROL: an issued statement keeps its booking claimed', p?.still_eligible === 0, `${p?.still_eligible}`)
    check('9. CONTROL: a SECOND, DIFFERENT host issued inside the SAME probe gets the CONSECUTIVE number, PS-2026-000003',
      p?.number2 === 'PS-2026-000003' && p?.status2 === 'paid' && p?.counter2 === 3, JSON.stringify(p))

    // ⚠️ The point of the whole probe technique: no number was burned.
    const [ctr] = sql('select year, last_number from public.payout_statement_counters')
    check('9. ⚠️ after every issue probe the counter is STILL (2026, 1) — no statement number was burned',
      ctr.year === 2026 && ctr.last_number === 1, JSON.stringify(ctr))
    const used = sql("select count(*)::int as n from public.payout_requests where statement_number in ('PS-2026-000002','PS-2026-000003')")[0].n
    check('9. ⚠️ PS-2026-000002 and PS-2026-000003 do not exist — the next real statements can still claim them', used === 0, `${used}`)
    const nreq = sql('select count(*)::int as n from public.payout_requests')[0].n
    check('9. ⚠️ payout_requests still holds exactly the one legacy row', nreq === 1, `${nreq}`)
  }

  // ── 10. Cancel and reverse ──────────────────────────────────────────────
  {
    const mkDraft = `declare v_req public.payout_requests; v_id uuid; begin select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E}); v_id := v_req.id;`
    const TODAY = "(now() at time zone 'Asia/Manila')::date"
    const cases = [
      { label: 'cancel with a blank admin email', sql: `${mkDraft} perform public.cancel_payout_statement(v_id, 'r', '  ');`, re: /An admin email is required/ },
      { label: 'cancel with no reason', sql: `${mkDraft} perform public.cancel_payout_statement(v_id, '   ', ${E});`, re: /A reason is required to cancel/ },
      { label: 'cancel an unknown id', sql: `${mkDraft} perform public.cancel_payout_statement('00000000-0000-4000-8000-000000000000', 'r', ${E});`, re: /Payout statement not found/ },
      { label: 'cancel an ISSUED statement -> "reverse it instead"', sql: `${mkDraft} perform public.issue_payout_statement(v_id, 'R', ${TODAY}, ${E}); perform public.cancel_payout_statement(v_id, 'r', ${E});`, re: /already issued — reverse it instead/ },
      { label: 'reverse with a blank admin email', sql: `${mkDraft} perform public.reverse_payout_statement(v_id, 'r', '  ');`, re: /An admin email is required/ },
      { label: 'reverse with no reason', sql: `${mkDraft} perform public.reverse_payout_statement(v_id, '   ', ${E});`, re: /A reason is required to reverse/ },
      { label: 'reverse an unknown id', sql: `${mkDraft} perform public.reverse_payout_statement('00000000-0000-4000-8000-000000000000', 'r', ${E});`, re: /Payout statement not found/ },
      { label: 'reverse a DRAFT -> "cancel it instead"', sql: `${mkDraft} perform public.reverse_payout_statement(v_id, 'r', ${E});`, re: /a draft, not an issued statement — cancel it instead/ },
    ]
    for (const c of cases) {
      const r = probe(`${c.sql} raise exception 'VERIFY unreached'; end;`)
      check(`10. ${c.label}`, r.raised && c.re.test(r.error ?? ''), `${(r.error ?? '').slice(0, 220)}`)
    }

    const cancelCtrl = probe(`
      declare v_req public.payout_requests; v_again public.payout_requests; v_id uuid; v_elig int; v_audit int; v_ctr int;
      begin
        select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E});
        v_id := v_req.id;
        select * into v_req from public.cancel_payout_statement(v_id, 'probe cancel', ${E});
        select count(*)::int into v_elig from public.payout_eligible_bookings('${H}');
        select * into v_again from public.cancel_payout_statement(v_id, 'second try', ${E});
        select count(*)::int into v_audit from public.admin_actions
          where action = 'payout_statement_cancel' and target_user_id = '${H}';
        select last_number into v_ctr from public.payout_statement_counters where year = 2026;
        raise exception 'VERIFY %', jsonb_build_object(
          'status', v_req.status, 'number', v_req.statement_number, 'notes', v_req.notes,
          'released', v_elig, 'idem_notes', v_again.notes, 'audit', v_audit, 'counter', v_ctr);
      end;`)
    const c1 = json(cancelCtrl)
    check('10. CONTROL (rolled back): cancelling a draft marks it failed with the reason in notes and NO number',
      c1?.status === 'failed' && c1?.number === null && c1?.notes === 'probe cancel', JSON.stringify(c1))
    check('10. CONTROL: cancelling RELEASES the booking — it is eligible again', c1?.released === 1, `${c1?.released}`)
    check('10. CONTROL: cancelling twice is idempotent (the first reason is not overwritten)', c1?.idem_notes === 'probe cancel', `${c1?.idem_notes}`)
    check('10. CONTROL: cancelling writes one payout_statement_cancel admin_actions row', c1?.audit === 1, `${c1?.audit}`)
    check('10. CONTROL: a cancelled draft consumed NO statement number (counter still 1)', c1?.counter === 1, `${c1?.counter}`)

    const reverseCtrl = probe(`
      declare v_req public.payout_requests; v_again public.payout_requests; v_id uuid; v_elig int; v_audit int; v_ctr int;
      begin
        select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E});
        v_id := v_req.id;
        select * into v_req from public.issue_payout_statement(v_id, 'PROBE-REV', ${TODAY}, ${E});
        select * into v_req from public.reverse_payout_statement(v_id, 'probe reversal', ${E});
        select count(*)::int into v_elig from public.payout_eligible_bookings('${H}');
        select * into v_again from public.reverse_payout_statement(v_id, 'second try', ${E});
        select count(*)::int into v_audit from public.admin_actions
          where action = 'payout_statement_reverse' and target_user_id = '${H}';
        select last_number into v_ctr from public.payout_statement_counters where year = 2026;
        raise exception 'VERIFY %', jsonb_build_object(
          'status', v_req.status, 'number', v_req.statement_number,
          'reversed', (v_req.reversed_at is not null), 'reason', v_req.reversal_reason,
          'released', v_elig, 'idem_reason', v_again.reversal_reason, 'audit', v_audit, 'counter', v_ctr);
      end;`)
    const c2 = json(reverseCtrl)
    check('10. CONTROL (rolled back): reversing an issued statement marks it failed, KEEPS its number and stamps reversed_at',
      c2?.status === 'failed' && c2?.number === 'PS-2026-000002' && c2?.reversed === true && c2?.reason === 'probe reversal', JSON.stringify(c2))
    check('10. CONTROL: reversing RELEASES the booking — the host is owed again', c2?.released === 1, `${c2?.released}`)
    check('10. CONTROL: reversing twice is idempotent (the first reason is not overwritten)', c2?.idem_reason === 'probe reversal', `${c2?.idem_reason}`)
    check('10. CONTROL: reversing writes one payout_statement_reverse admin_actions row', c2?.audit === 1, `${c2?.audit}`)
    check('10. CONTROL: a reversed statement keeps its number, so the counter is NOT rolled back (2 inside the probe)', c2?.counter === 2, `${c2?.counter}`)
  }

  // ── 11. Concurrent issue — two REAL overlapping Postgres connections ─────
  // Gaplessness rests on `insert … on conflict (year) do update … returning`
  // taking a row lock on the counter row, not on an exclusion constraint —
  // see the migration's own comment at the upsert. Proving TWO DISTINCT
  // consecutive numbers would need at least one of the two transactions to
  // COMMIT, which the global "nothing that consumes a statement number may
  // commit" rule forbids outright. So this proves the thing that constraint
  // still allows to be proven: the counter row genuinely serializes two
  // overlapping transactions (timing evidence — the second cannot finish
  // before the first releases the lock), not that it hands out two
  // different numbers. The SLOW probe takes the counter's row lock itself
  // (the same lock issue_payout_statement's own upsert takes) and holds it
  // under an explicit sleep; the FAST probe, started at the same instant,
  // can only reach ITS OWN issue_payout_statement call — and thus the same
  // row — after SLOW's transaction ends. Both roll back, so both
  // independently compute last_number+1 from the SAME pre-test value (no
  // lost update, no double-increment) — that identical result is expected,
  // not a bug, precisely because rollback erases each one's own increment
  // before the other proceeds.
  {
    const [{ last_number: preLast }] = sql('select last_number from public.payout_statement_counters where year = 2026')
    const TODAY = "(now() at time zone 'Asia/Manila')::date"
    const SLEEP_S = 1.5
    const slowBody = `
      declare v_req public.payout_requests; v_id uuid; v_n int;
      begin
        select * into v_req from public.create_payout_statement('${H}', ${EXPECTED}, ${E});
        v_id := v_req.id;
        -- Take the SAME row lock issue_payout_statement's own upsert takes,
        -- and hold it while sleeping — this is what forces real overlap.
        perform 1 from public.payout_statement_counters where year = 2026 for update;
        perform pg_sleep(${SLEEP_S});
        select * into v_req from public.issue_payout_statement(v_id, 'CONC-SLOW', ${TODAY}, ${E});
        select last_number into v_n from public.payout_statement_counters where year = 2026;
        raise exception 'VERIFY %', jsonb_build_object('number', v_req.statement_number, 'ctr', v_n);
      end;`
    const fastBody = `
      declare v_req public.payout_requests; v_id uuid; v_n int;
      begin
        select * into v_req from public.create_payout_statement('${HF}', ${EXPECTED_F}, ${E});
        v_id := v_req.id;
        select * into v_req from public.issue_payout_statement(v_id, 'CONC-FAST', ${TODAY}, ${E});
        select last_number into v_n from public.payout_statement_counters where year = 2026;
        raise exception 'VERIFY %', jsonb_build_object('number', v_req.statement_number, 'ctr', v_n);
      end;`
    const t0 = Date.now()
    const [slow, fast] = await Promise.all([
      probeAsync(slowBody).then((r) => ({ ...r, ms: Date.now() - t0 })),
      probeAsync(fastBody).then((r) => ({ ...r, ms: Date.now() - t0 })),
    ])
    const sp = json(slow), fp = json(fast)
    check('11. concurrent: both probes raised (rolled back) with a parsed payload',
      slow.raised && fast.raised && sp != null && fp != null, JSON.stringify({ sp, fp }))
    check('11. concurrent: both independently computed the SAME next number from the SAME starting point (rollback resets between them — this is the expected result, not a burned pair)',
      sp?.number === fp?.number && sp?.ctr === preLast + 1 && fp?.ctr === preLast + 1,
      JSON.stringify({ sp, fp, preLast }))
    // Serialization evidence: without a real row lock, FAST (no sleep of its
    // own) could finish in well under a second regardless of SLOW. If FAST
    // was genuinely blocked behind SLOW's held lock, it cannot finish before
    // SLOW's sleep does.
    check(`11. concurrent: the FAST probe (no sleep of its own) still took >= ${SLEEP_S}s — proof it was blocked behind SLOW's held row lock, not racing past it`,
      fast.ms >= SLEEP_S * 1000 - 200, `slow=${slow.ms}ms fast=${fast.ms}ms (floor ${SLEEP_S * 1000 - 200}ms)`)
    console.log(`11. NOTE: true concurrency (two DISTINCT consecutive numbers) cannot be observed without a commit, which the no-burn-a-number rule forbids. What is demonstrated above is that the counter's row lock genuinely serializes two overlapping transactions (timing), and that serialization does not corrupt the sequence (both independently land on last+1 from the same base) — not a race that could, under real commits, hand out the same number twice.`)

    const [{ last_number: postLast }] = sql('select last_number from public.payout_statement_counters where year = 2026')
    check('11. concurrent: counter unchanged after both rollbacks', postLast === preLast, `${preLast} -> ${postLast}`)
    const usedConc = sql("select count(*)::int as n from public.payout_requests where reference in ('CONC-SLOW','CONC-FAST')")[0].n
    check('11. concurrent: neither CONC-SLOW nor CONC-FAST exists as a real row afterward', usedConc === 0, `${usedConc}`)
  }

  // ── 12. The three stubbed old functions ──────────────────────────────────
  {
    const rp = await rpcAnon(HOST.token, 'request_payout', {})
    check('12. the host calling request_payout() -> "Payouts now use statements — reload the page."',
      rp.status !== 200 && /Payouts now use statements/.test(msg(rp)), `${rp.status} ${msg(rp)}`)
    const mp = await rpcService('mark_payout_paid', { p_request_id: LEGACY_REQUEST, p_reference: 'X' })
    check('12. the service role calling mark_payout_paid -> the same refusal',
      mp.status !== 200 && /Payouts now use statements/.test(msg(mp)), `${mp.status} ${msg(mp)}`)
    const mf = await rpcService('mark_payout_failed', { p_request_id: LEGACY_REQUEST, p_notes: 'X' })
    check('12. the service role calling mark_payout_failed -> the same refusal',
      mf.status !== 200 && /Payouts now use statements/.test(msg(mf)), `${mf.status} ${msg(mf)}`)
    // The stubs must keep their ACLs (CREATE OR REPLACE, not DROP+CREATE) and
    // their exact signatures — the defaults on the two mark_* functions are
    // why the first apply of 082 aborted.
    const acls = sql(`select p.proname, pg_get_function_arguments(p.oid) as args, p.proacl::text as acl
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname in ('request_payout','mark_payout_paid','mark_payout_failed')`)
    const rpRow = acls.find((a) => a.proname === 'request_payout')
    check('12. request_payout keeps its authenticated + service_role grants', /authenticated=X/.test(rpRow.acl) && /service_role=X/.test(rpRow.acl), rpRow.acl)
    for (const name of ['mark_payout_paid', 'mark_payout_failed']) {
      const row = acls.find((a) => a.proname === name)
      check(`12. ${name} stays service_role-only and keeps its "default null" second parameter`,
        /service_role=X/.test(row.acl) && !/authenticated=X/.test(row.acl) && /DEFAULT NULL/.test(row.args), `${row.acl} | ${row.args}`)
    }
    // CONTROL: the legacy row is untouched by the three refused calls.
    const [legacy] = sql(`select status::text as status, reference, notes from public.payout_requests where id = '${LEGACY_REQUEST}'`)
    check('12. CONTROL: the legacy request is unchanged after the three stub calls',
      legacy.status === 'paid' && legacy.reference === 'QA-GCASH-REF-001' && legacy.notes === null, JSON.stringify(legacy))
  }
} finally {
  await cleanup()
}

// ── 13. Cleanup, baselines and the forbidden rows ──────────────────────────
{
  const leftovers = await proveCleanup()
  check('13. every probe row is gone (re-read, not assumed)', leftovers.length === 0, leftovers.join(', '))

  const after = counts()
  const mine = new Set([...created.users, ...created.listings, ...created.bookings])
  for (const k of Object.keys(before)) {
    let detail = `${before[k]} -> ${after[k]}`
    if (before[k] !== after[k] && idsBefore[k]) {
      const now = idsOf(k)
      const added = [...now].filter((v) => !idsBefore[k].has(v))
      const removed = [...idsBefore[k]].filter((v) => !now.has(v))
      const untracked = [...added, ...removed].filter((v) => !mine.has(v))
      detail += ` | added=[${added.join(',')}] removed=[${removed.join(',')}]` +
        ` | none of them created by THIS run: ${untracked.length === added.length + removed.length}`
    }
    check(`13. baseline ${k}: ${before[k]} before, ${after[k]} after`, before[k] === after[k], detail)
  }

  const fAfter = sql(`
    select (select updated_at::text from public.profiles where id = '${FORBIDDEN_HOST}') as host_updated,
           (select updated_at::text from public.bookings where booking_ref = '${FORBIDDEN_BOOKING_REF}') as booking_updated,
           (select status::text from public.bookings where booking_ref = '${FORBIDDEN_BOOKING_REF}') as booking_status
  `)[0]
  check('13. forbidden host c38111b3-… untouched', fAfter.host_updated === fBefore.host_updated, `${fBefore.host_updated} -> ${fAfter.host_updated}`)
  check('13. forbidden booking RNT-A4DA55 untouched',
    fAfter.booking_updated === fBefore.booking_updated && fAfter.booking_status === fBefore.booking_status,
    `${fBefore.booking_updated}/${fBefore.booking_status} -> ${fAfter.booking_updated}/${fAfter.booking_status}`)
}

done()
