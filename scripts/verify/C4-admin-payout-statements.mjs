// Verifies the admin payout-statement surface (Task C4): /admin/payouts,
// /admin/payouts/[id] and the five /api/admin/payout-statements routes.
//
// ⚠️ THIS SCRIPT ISSUES ONE REAL STATEMENT AND THEREFORE CONSUMES ONE REAL,
// GAPLESS STATEMENT NUMBER. It does so against a THROWAWAY @example.com host
// only — never a real one. The number consumed is printed at the end, and
// teardown restores payout_statement_counters to the highest number still held
// by a SURVIVING row (guarded: it refuses to touch the counter if any row
// outside this run holds a higher 2026 number). Everything issuing writes is
// deleted and re-read to prove it gone.
//
// Every authorisation claim uses a real signed-in session (forged SSR cookie —
// this repo's documented pattern, built from a real password sign-in). The
// service role is used only for setup, independent re-reads and teardown.
//
// Usage:
//   RESEND_API_KEY= node --experimental-strip-types scripts/verify/C4-admin-payout-statements.mjs [appUrl]
//
// The APP SERVER must also run with RESEND_API_KEY blank. Since Task C5 the
// senders are real: with a key set, the `emailed:false` checks below would
// fail and a real statement email would be attempted.
import { URL as SUPABASE_URL, ANON, SECRET, admin, signIn, check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'

const ADMIN_EMAIL = 'demo@demo.rentivo.ph' // on the local ADMIN_EMAILS allowlist
const RENTER_EMAIL = 'renter@demo.rentivo.ph'
const PW = 'DemoRentivo1'
const LEGACY_ID = 'a6194f2f-5599-4824-8e38-f4cc81af4d5f' // PS-2026-000001, read-only here

const stamp = Date.now().toString(36)
const created = { users: [], listings: [], bookings: [], requests: [] }

const manilaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
const manilaPlus = (days) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(
    new Date(Date.now() + days * 86400000)
  )

async function signInFull(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(json)}`)
  return json
}
function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) =>
    `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`
  ).join('; ')
}

const getPage = (path, cookie) =>
  fetch(`${APP}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} })

async function pageText(path, cookie) {
  const res = await getPage(path, cookie)
  return { status: res.status, html: res.status === 200 ? await res.text() : '' }
}

async function post(path, cookie, rawBody) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? {}),
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function createUser(label) {
  const email = `probe-c4-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  await signIn(email, PW)
  return { id: j.id, email }
}

async function counts() {
  const out = {}
  for (const [k, q] of [
    ['bookings', 'bookings?select=id'],
    ['listings', 'listings?select=id'],
    ['profiles', 'profiles?select=id'],
    ['payout_requests', 'payout_requests?select=id'],
    ['payout_items', 'payout_items?select=booking_id'],
    ['payout_accounts', 'payout_accounts?select=id'],
    ['admin_actions', 'admin_actions?select=id'],
    ['notifications', 'notifications?select=id'],
    ['conversations', 'conversations?select=id'],
  ]) {
    out[k] = (await admin(q)).body?.length ?? -1
  }
  const c = (await admin('payout_statement_counters?select=year,last_number')).body ?? []
  out.counter2026 = c.find((r) => r.year === 2026)?.last_number ?? null
  return out
}

async function owedFor(hostId) {
  const r = await admin('rpc/payouts_owed', { method: 'POST', body: JSON.stringify({ p_host_id: null }) })
  return (r.body ?? []).find((o) => o.host_id === hostId) ?? null
}

async function forbiddenSnapshot() {
  const h = (await admin(`profiles?select=id,suspended_at,full_name&id=eq.${FORBIDDEN_HOST}`)).body
  const b = (await admin(`bookings?select=updated_at,status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)).body
  return JSON.stringify({ h, b })
}

let HOST, RENTER, LISTING_ID, BOOKING, DRAFT1, DRAFT2
let consumedNumber = null

try {
  const before = await counts()
  const forbiddenBefore = await forbiddenSnapshot()
  console.log('BASELINE', JSON.stringify(before))
  check('BASELINE counter for 2026 read', before.counter2026 !== null, String(before.counter2026))

  const adminSession = await signInFull(ADMIN_EMAIL, PW)
  const renterSession = await signInFull(RENTER_EMAIL, PW)
  const adminCookie = cookieHeaderFor(adminSession)
  const renterCookie = cookieHeaderFor(renterSession)

  // ── 1. Access matrix ────────────────────────────────────────────────────
  for (const path of ['/admin/payouts', `/admin/payouts/${LEGACY_ID}`]) {
    const out = await getPage(path, null)
    const loc = out.headers.get('location') ?? ''
    check(
      `MATRIX page ${path} signed out → 307 to /login?next=`,
      out.status === 307 && loc.includes('/login?next='),
      `${out.status} ${loc}`
    )
    const r = await getPage(path, renterCookie)
    check(`MATRIX page ${path} demo renter → 404`, r.status === 404, String(r.status))
    const a = await getPage(path, adminCookie)
    check(`MATRIX page ${path} admin → 200`, a.status === 200, String(a.status))
  }

  const ROUTES = [
    ['/api/admin/payout-statements', {}],
    [`/api/admin/payout-statements/${LEGACY_ID}/issue`, {}],
    [`/api/admin/payout-statements/${LEGACY_ID}/cancel`, {}],
    [`/api/admin/payout-statements/${LEGACY_ID}/reverse`, {}],
    [`/api/admin/payout-statements/${LEGACY_ID}/resend-email`, {}],
  ]
  for (const [path, body] of ROUTES) {
    const out = await post(path, null, body)
    check(`MATRIX route ${path} signed out → 404`, out.status === 404, String(out.status))
    const r = await post(path, renterCookie, body)
    check(`MATRIX route ${path} demo renter → 404`, r.status === 404, String(r.status))
  }
  // Admin: a real validation error, not a stub. Each empty body hits this
  // route's OWN validator, which is past the admin gate.
  const expectAdmin400 = [
    ['/api/admin/payout-statements', {}, 'A host is required.'],
    [`/api/admin/payout-statements/${LEGACY_ID}/issue`, {}, 'A transfer reference is required.'],
    [`/api/admin/payout-statements/${LEGACY_ID}/cancel`, {}, 'A reason is required to cancel a draft.'],
    [`/api/admin/payout-statements/${LEGACY_ID}/reverse`, {}, 'A reason is required to reverse a statement.'],
  ]
  for (const [path, body, msg] of expectAdmin400) {
    const a = await post(path, adminCookie, body)
    check(
      `MATRIX route ${path} admin → 400 "${msg}"`,
      a.status === 400 && a.body?.error === msg,
      `${a.status} ${JSON.stringify(a.body)}`
    )
  }
  {
    // resend-email has no body to validate, so its admin-reached proof is the
    // RPC-side truth about the LEGACY row: it IS issued, so the route gets past
    // every guard and reaches the sender, which returns false with RESEND_API_KEY blank.
    // That is only reachable past the admin gate.
    const a = await post(`/api/admin/payout-statements/${LEGACY_ID}/resend-email`, adminCookie, {})
    check(
      'MATRIX route resend-email admin → 200 and reaches the sender (emailed:false, Resend unconfigured)',
      a.status === 200 && a.body?.emailed === false,
      `${a.status} ${JSON.stringify(a.body)}`
    )
    const { body: legacy } = await admin(
      `payout_requests?select=statement_emailed_at,statement_number&id=eq.${LEGACY_ID}`
    )
    check(
      'CONTROL the legacy statement was NOT marked emailed by that call',
      legacy?.[0]?.statement_emailed_at === null && legacy?.[0]?.statement_number === 'PS-2026-000001',
      JSON.stringify(legacy)
    )
  }
  {
    const a = await post('/api/admin/payout-statements', adminCookie, 'not json')
    check(
      'ROUTE create with malformed JSON → 400 "Invalid request."',
      a.status === 400 && a.body?.error === 'Invalid request.',
      `${a.status} ${JSON.stringify(a.body)}`
    )
  }

  // ── 2. Setup: a throwaway host with exactly one eligible booking ────────
  HOST = await createUser('host')
  RENTER = await createUser('renter')
  await admin(`profiles?id=eq.${HOST.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: `Probe C4 Host ${stamp}`, is_host: true }),
  })
  const { body: listingRows } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: HOST.id, category: 'lens', brand: 'Probe', model: 'C4',
      title: `Probe C4 Lens ${stamp}`, daily_price: 1000, city: 'Manila', province: 'Metro Manila',
      latitude: 14.5995, longitude: 120.9842, is_active: true, is_draft: false,
    }),
  })
  if (!listingRows?.[0]?.id) throw new Error('listing insert failed')
  LISTING_ID = listingRows[0].id
  created.listings.push(LISTING_ID)

  const RENTAL = 4321
  const DELIVERY = 79
  const PAYABLE = RENTAL + DELIVERY // 4400
  const { body: bookingRows } = await admin('bookings', {
    method: 'POST',
    body: JSON.stringify({
      listing_id: LISTING_ID, renter_id: RENTER.id, host_id: HOST.id,
      // total_days is GENERATED — inserting it is a 428C9 (C1's finding).
      pickup_date: '2026-08-01', return_date: '2026-08-03',
      rental_fee: RENTAL, security_deposit: 0, service_fee: Math.round(RENTAL * 0.05),
      protection_fee: 0, delivery_fee: DELIVERY,
      total_amount: RENTAL + Math.round(RENTAL * 0.05) + DELIVERY,
      status: 'completed', payment_status: 'paid', payment_method: 'qrph', service_fee_bps: 500,
    }),
  })
  if (!bookingRows?.[0]?.id) throw new Error('booking insert failed: ' + JSON.stringify(bookingRows))
  BOOKING = { id: bookingRows[0].id, ref: bookingRows[0].booking_ref }
  created.bookings.push(BOOKING.id)

  const { body: acct } = await admin('payout_accounts', {
    method: 'POST',
    body: JSON.stringify({
      user_id: HOST.id, method: 'GCash', account_number: '09990000444',
      account_name: 'Probe C4 Payee', status: 'verified',
    }),
  })
  if (!acct?.[0]?.id) throw new Error('payout_account insert failed')

  {
    const o = await owedFor(HOST.id)
    check(
      'SETUP payouts_owed sees the probe host at the expected amount',
      o?.bookings === 1 && o?.amount === PAYABLE,
      JSON.stringify(o)
    )
  }

  // ── 3. The Owed section renders the host with no blocker ────────────────
  {
    const { status, html } = await pageText('/admin/payouts', adminCookie)
    check('PAGE /admin/payouts renders for the admin', status === 200, String(status))
    check('PAGE owed section names the probe host', html.includes(`Probe C4 Host ${stamp}`), '')
    check('PAGE owed section shows the amount', html.includes('₱4,400'), '')
    check('PAGE owed row offers Prepare statement', html.includes('Prepare statement'), '')
    check('PAGE section headings present', html.includes('Owed to Hosts') && html.includes('Drafts'), '')
  }

  // ── 4. expectedAmount is the admin's number, not the server's ───────────
  {
    const bad = await post('/api/admin/payout-statements', adminCookie, {
      hostId: HOST.id,
      expectedAmount: PAYABLE - 1,
    })
    check(
      'REFUSAL prepare with a stale expectedAmount → 400 naming both numbers',
      bad.status === 400 && /changed from 4399 to 4400/.test(bad.body?.error ?? ''),
      `${bad.status} ${JSON.stringify(bad.body)}`
    )
    const { body: none } = await admin(`payout_requests?select=id&host_id=eq.${HOST.id}`)
    check('CONTROL the refused prepare left no draft behind', none.length === 0, JSON.stringify(none))
  }
  {
    // CONTROL: the same call differing ONLY in expectedAmount succeeds.
    const ok = await post('/api/admin/payout-statements', adminCookie, {
      hostId: HOST.id,
      expectedAmount: PAYABLE,
    })
    check('CONTROL prepare with the right expectedAmount → 200', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`)
    DRAFT1 = ok.body?.request?.id
    created.requests.push(DRAFT1)
    check(
      'DRAFT is pending, unnumbered, priced, and snapshots the account',
      ok.body?.request?.status === 'pending' &&
        ok.body?.request?.statement_number === null &&
        ok.body?.request?.amount === PAYABLE &&
        ok.body?.request?.account_method === 'GCash' &&
        ok.body?.request?.account_name === 'Probe C4 Payee' &&
        ok.body?.request?.account_number === '09990000444',
      JSON.stringify(ok.body?.request)
    )
    const { body: items } = await admin(
      `payout_items?select=booking_id,amount,booking_ref,rental_fee,delivery_fee&payout_request_id=eq.${DRAFT1}`
    )
    check(
      'DRAFT itemizes exactly the one eligible booking',
      items.length === 1 && items[0].booking_id === BOOKING.id && items[0].amount === PAYABLE,
      JSON.stringify(items)
    )
    check('DRAFT removes the host from payouts_owed', (await owedFor(HOST.id)) === null, '')
  }

  // ── 5. One draft at a time, and the page says so ────────────────────────
  {
    const dup = await post('/api/admin/payout-statements', adminCookie, {
      hostId: HOST.id,
      expectedAmount: PAYABLE,
    })
    check(
      'REFUSAL a second prepare while a draft is open → 400',
      dup.status === 400 && /already has a draft/.test(dup.body?.error ?? ''),
      `${dup.status} ${JSON.stringify(dup.body)}`
    )
  }
  {
    const { html } = await pageText('/admin/payouts', adminCookie)
    check('PAGE draft is listed with its account snapshot', html.includes('Probe C4 Payee'), '')
    check('PAGE draft offers Record transfer and Cancel draft', html.includes('Record transfer') && html.includes('Cancel draft'), '')
    check(
      'PAGE no account-changed warning while the account still matches',
      !html.includes('Account changed since this draft'),
      ''
    )
  }

  // ── 6. The changed-account warning (and it does NOT block issuing) ──────
  {
    await admin(`payout_accounts?user_id=eq.${HOST.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ account_number: '09991111555' }),
    })
    const { html } = await pageText('/admin/payouts', adminCookie)
    check(
      'PAGE warns, verbatim, once the host account differs from the snapshot',
      html.includes('Account changed since this draft — cancel and re-prepare unless you already sent it.'),
      ''
    )
    await admin(`payout_accounts?user_id=eq.${HOST.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ account_number: '09990000444' }),
    })
    const { html: back } = await pageText('/admin/payouts', adminCookie)
    check(
      'CONTROL the warning disappears again once it matches',
      !back.includes('Account changed since this draft'),
      ''
    )
  }

  // ── 7. A draft is not a statement ───────────────────────────────────────
  {
    const rev = await post(`/api/admin/payout-statements/${DRAFT1}/reverse`, adminCookie, {
      reason: 'probe',
      confirmStatementNumber: 'PS-2026-000999',
    })
    check(
      'REFUSAL reverse on a draft → 400 pointing at cancel',
      rev.status === 400 && /draft, not an issued statement/.test(rev.body?.error ?? ''),
      `${rev.status} ${JSON.stringify(rev.body)}`
    )
    const re = await post(`/api/admin/payout-statements/${DRAFT1}/resend-email`, adminCookie, {})
    check(
      'REFUSAL resend-email on a draft → 400',
      re.status === 400 && /not been issued yet/.test(re.body?.error ?? ''),
      `${re.status} ${JSON.stringify(re.body)}`
    )
  }

  // ── 8. Cancel a draft: no number consumed, bookings released ────────────
  {
    const noReason = await post(`/api/admin/payout-statements/${DRAFT1}/cancel`, adminCookie, { reason: '   ' })
    check(
      'REFUSAL cancel with a blank reason → 400',
      noReason.status === 400 && noReason.body?.error === 'A reason is required to cancel a draft.',
      `${noReason.status} ${JSON.stringify(noReason.body)}`
    )
    const ok = await post(`/api/admin/payout-statements/${DRAFT1}/cancel`, adminCookie, {
      reason: 'Probe C4 — cancelling to re-prepare',
    })
    check(
      'CONTROL cancel with a reason → 200, failed, still unnumbered',
      ok.status === 200 &&
        ok.body?.request?.status === 'failed' &&
        ok.body?.request?.statement_number === null &&
        ok.body?.request?.notes === 'Probe C4 — cancelling to re-prepare',
      `${ok.status} ${JSON.stringify(ok.body?.request)}`
    )
    const o = await owedFor(HOST.id)
    check('CANCEL releases the booking back into payouts_owed', o?.amount === PAYABLE, JSON.stringify(o))
    const c = await counts()
    check('CANCEL consumed no statement number', c.counter2026 === before.counter2026, `${c.counter2026}`)
  }

  // ── 9. Prepare again, then the issue refusals ───────────────────────────
  {
    const ok = await post('/api/admin/payout-statements', adminCookie, {
      hostId: HOST.id,
      expectedAmount: PAYABLE,
    })
    check('PREPARE a second draft after the cancel → 200', ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`)
    DRAFT2 = ok.body?.request?.id
    created.requests.push(DRAFT2)
  }
  {
    const cases = [
      ['blank reference', { reference: '  ', transferredOn: manilaToday() }, /reference is required/],
      ['a 101-character reference', { reference: 'x'.repeat(101), transferredOn: manilaToday() }, /100 characters or fewer/],
      ['an impossible date', { reference: 'PROBE', transferredOn: '2026-02-31' }, /valid transfer date is required/],
      ['a non-date string', { reference: 'PROBE', transferredOn: 'tomorrow' }, /valid transfer date is required/],
      ['a future transfer date', { reference: 'PROBE', transferredOn: manilaPlus(1) }, /cannot be in the future/],
    ]
    for (const [label, body, re] of cases) {
      const out = await post(`/api/admin/payout-statements/${DRAFT2}/issue`, adminCookie, body)
      check(
        `REFUSAL issue with ${label} → 400`,
        out.status === 400 && re.test(out.body?.error ?? ''),
        `${out.status} ${JSON.stringify(out.body)}`
      )
    }
    const { body: still } = await admin(`payout_requests?select=status,statement_number&id=eq.${DRAFT2}`)
    check(
      'CONTROL none of those refusals numbered or issued the draft',
      still?.[0]?.status === 'pending' && still?.[0]?.statement_number === null,
      JSON.stringify(still)
    )
    const c = await counts()
    check('CONTROL none of those refusals moved the counter', c.counter2026 === before.counter2026, `${c.counter2026}`)
  }

  // ── 10. Issue — the one call that consumes a number ─────────────────────
  {
    const out = await post(`/api/admin/payout-statements/${DRAFT2}/issue`, adminCookie, {
      reference: `PROBE-C4-${stamp}`,
      transferredOn: manilaToday(),
    })
    check('ISSUE valid → 200', out.status === 200, `${out.status} ${JSON.stringify(out.body)}`)
    consumedNumber = out.body?.request?.statement_number ?? null
    check(
      'ISSUE returns a paid, numbered statement with the transfer recorded',
      out.body?.request?.status === 'paid' &&
        /^PS-\d{4}-\d{6}$/.test(consumedNumber ?? '') &&
        out.body?.request?.reference === `PROBE-C4-${stamp}` &&
        out.body?.request?.transferred_on === manilaToday() &&
        out.body?.request?.processed_at !== null,
      JSON.stringify(out.body?.request)
    )
    check(
      'ISSUE reports emailed:false when no email was actually sent (Resend unconfigured)',
      out.body?.emailed === false,
      JSON.stringify(out.body?.emailed)
    )
    const { body: row } = await admin(`payout_requests?select=statement_emailed_at&id=eq.${DRAFT2}`)
    check(
      'CONTROL a failed send leaves statement_emailed_at null rather than claiming a send',
      row?.[0]?.statement_emailed_at === null,
      JSON.stringify(row)
    )
    const c = await counts()
    check(
      'ISSUE advanced the counter by exactly one',
      c.counter2026 === before.counter2026 + 1,
      `${before.counter2026} → ${c.counter2026}`
    )
  }

  // ── 11. The issued list and the statement document ──────────────────────
  {
    const { html } = await pageText('/admin/payouts', adminCookie)
    check('PAGE issued list shows the new statement number', html.includes(consumedNumber), '')
    check('PAGE issued list flags the un-emailed statement', html.includes('Email not sent — Resend'), '')
    check('PAGE issued list shows the Paid status', html.includes('Issued Statements'), '')
  }
  {
    const { status, html } = await pageText(`/admin/payouts/${DRAFT2}`, adminCookie)
    check('PAGE /admin/payouts/[id] renders for the admin', status === 200, String(status))
    check('DETAIL renders the statement document', html.includes('receipt-print-area'), '')
    check('DETAIL shows the statement number', html.includes(consumedNumber), '')
    check('DETAIL shows the booking reference from the snapshot', html.includes(BOOKING.ref), '')
    // The DOCUMENT shows the account masked. The full number is still present
    // in the serialized props (PayoutStatement is a client component) — which
    // is fine HERE and only here: the admin is the person making the transfer,
    // and /admin/payouts prints the draft's full account details on purpose.
    check('DETAIL renders the account masked on the document', html.includes('•••• 0444'), '')
    check(
      'DETAIL offers Reverse and the email control',
      html.includes('Reverse this statement') && (html.includes('Send email') || html.includes('Resend email')),
      ''
    )
  }
  {
    // An admin reading a statement that is not theirs is the whole point of
    // createAdminClient() here: under a user session RLS would return nothing.
    const asRenter = await getPage(`/admin/payouts/${DRAFT2}`, renterCookie)
    check('CONTROL the same detail page is 404 for the demo renter', asRenter.status === 404, String(asRenter.status))
  }

  // ── 12. An issued statement cannot be cancelled, only reversed ──────────
  {
    const out = await post(`/api/admin/payout-statements/${DRAFT2}/cancel`, adminCookie, { reason: 'probe' })
    check(
      'REFUSAL cancel on an issued statement → 400 pointing at reverse',
      out.status === 400 && /already issued — reverse it instead/.test(out.body?.error ?? ''),
      `${out.status} ${JSON.stringify(out.body)}`
    )
  }

  // ── 13. Resend on a real issued statement reaches the sender ────────────
  {
    const out = await post(`/api/admin/payout-statements/${DRAFT2}/resend-email`, adminCookie, {})
    check(
      'RESEND on an issued statement → 200 (emailed:false, Resend unconfigured)',
      out.status === 200 && out.body?.emailed === false,
      `${out.status} ${JSON.stringify(out.body)}`
    )
  }

  // ── 14. Reverse: typing the number is the gate, re-checked server-side ──
  {
    const wrong = await post(`/api/admin/payout-statements/${DRAFT2}/reverse`, adminCookie, {
      reason: 'Probe C4 reversal',
      confirmStatementNumber: 'PS-2026-000999',
    })
    check(
      'REFUSAL reverse with the wrong statement number → 400',
      wrong.status === 400 && wrong.body?.error === 'The statement number you typed does not match.',
      `${wrong.status} ${JSON.stringify(wrong.body)}`
    )
    const noReason = await post(`/api/admin/payout-statements/${DRAFT2}/reverse`, adminCookie, {
      reason: '  ',
      confirmStatementNumber: consumedNumber,
    })
    check(
      'REFUSAL reverse with a blank reason → 400',
      noReason.status === 400 && /reason is required/.test(noReason.body?.error ?? ''),
      `${noReason.status} ${JSON.stringify(noReason.body)}`
    )
    const { body: untouched } = await admin(`payout_requests?select=status,reversed_at&id=eq.${DRAFT2}`)
    check(
      'CONTROL neither refusal reversed anything',
      untouched?.[0]?.status === 'paid' && untouched?.[0]?.reversed_at === null,
      JSON.stringify(untouched)
    )

    const ok = await post(`/api/admin/payout-statements/${DRAFT2}/reverse`, adminCookie, {
      reason: 'Probe C4 reversal',
      confirmStatementNumber: consumedNumber,
    })
    check(
      'CONTROL reverse with the exact number and a reason → 200',
      ok.status === 200 &&
        ok.body?.request?.status === 'failed' &&
        ok.body?.request?.reversed_at !== null &&
        ok.body?.request?.statement_number === consumedNumber &&
        ok.body?.request?.reversal_reason === 'Probe C4 reversal',
      `${ok.status} ${JSON.stringify(ok.body?.request)}`
    )
    const o = await owedFor(HOST.id)
    check('REVERSE releases the booking — the host is owed again', o?.amount === PAYABLE, JSON.stringify(o))
    const c = await counts()
    check(
      'REVERSE does not roll the counter back — the number is never reused',
      c.counter2026 === before.counter2026 + 1,
      `${c.counter2026}`
    )
  }
  {
    const { html } = await pageText(`/admin/payouts/${DRAFT2}`, adminCookie)
    check('DETAIL marks the reversed statement REVERSED', html.includes('REVERSED'), '')
    check('DETAIL withdraws the Reverse control once reversed', !html.includes('Reverse this statement'), '')
    const { html: list } = await pageText('/admin/payouts', adminCookie)
    check('PAGE issued list shows it as Reversed', list.includes('Reversed'), '')
  }

  // ── 15. Audit rows name the acting admin ────────────────────────────────
  {
    const { body: rows } = await admin(
      `admin_actions?select=action,admin_email,target_user_id&target_user_id=eq.${HOST.id}&order=created_at.asc`
    )
    const actions = rows.map((r) => r.action)
    check(
      'AUDIT one row per lifecycle action, in order',
      actions.join(',') ===
        'payout_statement_draft,payout_statement_cancel,payout_statement_draft,payout_statement_issue,payout_statement_reverse',
      actions.join(',')
    )
    check(
      'AUDIT every row names the acting admin, not a service account',
      rows.length > 0 && rows.every((r) => r.admin_email === ADMIN_EMAIL),
      JSON.stringify(rows.map((r) => r.admin_email))
    )
  }

  // ── 16. Teardown ────────────────────────────────────────────────────────
  for (const id of created.requests) {
    await admin(`payout_items?payout_request_id=eq.${id}`, { method: 'DELETE' })
    await admin(`payout_requests?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const u of created.users) {
    await admin(`payout_accounts?user_id=eq.${u}`, { method: 'DELETE' })
  }
  for (const b of created.bookings) {
    await admin(`conversations?booking_id=eq.${b}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${b}`, { method: 'DELETE' })
  }
  for (const l of created.listings) {
    await admin(`availability_blocks?listing_id=eq.${l}`, { method: 'DELETE' })
    await admin(`listings?id=eq.${l}`, { method: 'DELETE' })
  }
  for (const u of created.users) {
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`admin_actions?target_user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`rate_limit_hits?key=like.*${u}*`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  }

  // Re-read to prove the probe rows are gone, not merely deleted-by-request.
  {
    const leftovers = []
    for (const u of created.users) {
      for (const [t, q] of [
        ['profiles', `profiles?select=id&id=eq.${u}`],
        ['payout_accounts', `payout_accounts?select=id&user_id=eq.${u}`],
        ['payout_requests', `payout_requests?select=id&host_id=eq.${u}`],
        ['notifications', `notifications?select=id&user_id=eq.${u}`],
        ['admin_actions', `admin_actions?select=id&target_user_id=eq.${u}`],
      ]) {
        const n = (await admin(q)).body?.length ?? 0
        if (n) leftovers.push(`${t}:${u}:${n}`)
      }
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, {
        headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
      })
      if (r.status !== 404) leftovers.push(`auth:${u}:${r.status}`)
    }
    for (const b of created.bookings) {
      if ((await admin(`bookings?select=id&id=eq.${b}`)).body.length) leftovers.push(`booking:${b}`)
    }
    for (const l of created.listings) {
      if ((await admin(`listings?select=id&id=eq.${l}`)).body.length) leftovers.push(`listing:${l}`)
    }
    check('TEARDOWN every probe row re-read and provably gone', leftovers.length === 0, leftovers.join(', '))
  }

  // ── 17. Restore the statement counter, GUARDED ──────────────────────────
  // The probe's number belonged to a row that no longer exists, so leaving the
  // counter advanced would permanently skip a number in a gapless series for a
  // payout that never happened. Restoring is only safe if nothing OUTSIDE this
  // run holds a 2026 number above the one we are restoring to — otherwise the
  // next real issue would collide on statement_number.
  {
    const { body: survivors } = await admin(
      'payout_requests?select=statement_number&statement_number=like.PS-2026-*&order=statement_number.desc'
    )
    const highest = survivors?.[0]?.statement_number ?? null
    const target = highest ? Number(highest.slice(-6)) : 0
    const { body: nowCounter } = await admin('payout_statement_counters?select=last_number&year=eq.2026')
    const live = nowCounter?.[0]?.last_number
    if (live === before.counter2026 + 1 && target === before.counter2026) {
      await admin('payout_statement_counters?year=eq.2026', {
        method: 'PATCH',
        body: JSON.stringify({ last_number: target }),
      })
      const { body: after } = await admin('payout_statement_counters?select=last_number&year=eq.2026')
      check(
        `COUNTER restored to ${target} (the probe's ${consumedNumber} is released; highest surviving is ${highest})`,
        after?.[0]?.last_number === target,
        JSON.stringify(after)
      )
    } else {
      check(
        'COUNTER left advanced — another statement exists, restoring would collide',
        false,
        `live=${live} expected=${before.counter2026 + 1} highestSurviving=${highest}. ` +
          `${consumedNumber} stays consumed; the next real statement is PS-2026-${String(live + 1).padStart(6, '0')}.`
      )
    }
  }

  // ── 18. Baselines and the forbidden rows ────────────────────────────────
  const after = await counts()
  for (const k of Object.keys(before)) {
    check(`BASELINE ${k} unchanged (${before[k]})`, before[k] === after[k], `${before[k]} → ${after[k]}`)
  }
  const forbiddenAfter = await forbiddenSnapshot()
  check(
    'FORBIDDEN host and booking untouched',
    forbiddenAfter === forbiddenBefore,
    forbiddenAfter === forbiddenBefore ? 'identical' : `${forbiddenBefore} → ${forbiddenAfter}`
  )
  console.log(`\nSTATEMENT NUMBER CONSUMED BY THIS RUN: ${consumedNumber}`)
} catch (e) {
  check('SCRIPT completed without throwing', false, String(e?.stack ?? e))
  console.log('created:', JSON.stringify(created))
}

done()
