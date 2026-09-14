// Verifies Task C6 (spec §11): account deletion respects payout statements.
//
//   1. A throwaway host with one eligible completed+paid booking is blocked
//      from deleting their own account (POST /api/account/delete) AND from
//      being deleted by an admin (POST /api/admin/users/[id]/delete), both
//      400 with the exact owed amount named.
//   2. Once that booking is claimed by a COMMITTED draft payout statement
//      (create_payout_statement, real — drafts consume no statement number),
//      the owed gate clears and the draft gate blocks instead, on both
//      routes.
//   3. Cancelling the draft and cancelling the booking (so nothing is owed)
//      lets the self-service route succeed (200).
//   4. Before that deletion, a payout_requests row is seeded DIRECTLY (never
//      via issue_payout_statement, which would burn a real gapless number)
//      in the shape an issued statement takes — status 'paid',
//      statement_number 'PS-2026-999999' (outside the live series) — so the
//      deletion's snapshot-scrub can be proven: account_name/account_number
//      anonymized, statement_number/amount/reference/transferred_on and every
//      payout_items row (including listing_title) untouched.
//
// Real HTTP calls against a running server (never the service role, which
// bypasses the routes entirely) for every claim about the two DELETE routes.
// Service role is used only for setup, independent re-reads, and cleanup.
//
// Usage: RESEND_API_KEY= node --experimental-strip-types scripts/verify/082-account-deletion-payouts.mjs [appUrl]
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3105'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_REF = 'RNT-A4DA55'
const ADMIN_EMAIL = 'demo@demo.rentivo.ph'
const ADMIN_PASSWORD = 'DemoRentivo1'
const ALLOWLIST = (process.env.ADMIN_EMAILS ?? '').toLowerCase()

const stamp = Date.now()
const created = { users: [], listings: [], bookings: [] }
const FAKE_STATEMENT_NUMBER = 'PS-2026-999999'
let fakeRequestId = null

function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) =>
    `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`
  ).join('; ')
}
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
async function createUser(label, meta = {}) {
  const email = `probe-082del-${label}-${stamp}@example.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true, ...meta }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  const session = await signInFull(email, 'ProbeRentivo1')
  return { id: j.id, email, cookie: cookieHeaderFor(session) }
}
async function hardDeleteUser(id) {
  return fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}
async function getAuthUser(id) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
  return res.json()
}
/** POST exactly as the two Delete routes are called from their real UIs. */
async function del(cookie, path, body) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const peso = (n) => `₱${n.toLocaleString('en-PH')}`

async function main() {
  if (!ALLOWLIST.includes(ADMIN_EMAIL))
    throw new Error(`ADMIN_EMAILS in .env.local does not include ${ADMIN_EMAIL} — /admin would 404 for it. See AGENTS.md.`)

  // ── Baselines ──────────────────────────────────────────────────────────
  const countOf = async (table, col = 'id') => (await admin(`${table}?select=${col}`)).body.length
  const before = {
    bookings: await countOf('bookings'),
    payout_requests: await countOf('payout_requests'),
    payout_items: await countOf('payout_items', 'booking_id'),
    payout_accounts: await countOf('payout_accounts'),
    admin_actions: await countOf('admin_actions'),
    notifications: await countOf('notifications'),
    listings: await countOf('listings'),
    profiles: await countOf('profiles'),
  }
  const { body: [counterBefore] } = await admin('payout_statement_counters?select=year,last_number&year=eq.2026')
  const { body: [forbiddenHostBefore] } = await admin(`profiles?select=id,full_name,suspended_at&id=eq.${FORBIDDEN_HOST}`)
  const { body: [forbiddenBookingBefore] } = await admin(`bookings?select=id,status,payment_status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)

  try {
    // ── Setup: a throwaway host + renter with one eligible booking ────────
    const HOST = await createUser('host')
    const RENTER = await createUser('renter')
    await admin(`profiles?id=eq.${HOST.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ full_name: 'Probe C6 Host', is_host: true, is_verified: true }),
    })

    const { body: listingRows } = await admin('listings', {
      method: 'POST',
      body: JSON.stringify({
        host_id: HOST.id, category: 'lens', brand: 'Probe', model: 'C6',
        title: 'Probe C6 Deletion Lens', daily_price: 4000, security_deposit: 0,
        city: 'Manila', province: 'Metro Manila',
        latitude: 14.5995, longitude: 120.9842, location_is_exact: true,
        is_active: true, is_draft: false,
      }),
    })
    const listingId = listingRows?.[0]?.id
    if (!listingId) throw new Error('listing insert failed: ' + JSON.stringify(listingRows))
    created.listings.push(listingId)

    const RENTAL_FEE = 8000
    const SERVICE_FEE = Math.round(RENTAL_FEE * 0.05)
    const PAYABLE = RENTAL_FEE // delivery_fee 0
    const TOTAL = RENTAL_FEE + SERVICE_FEE
    const { body: bookingRows } = await admin('bookings', {
      method: 'POST',
      body: JSON.stringify({
        listing_id: listingId, renter_id: RENTER.id, host_id: HOST.id,
        pickup_date: '2026-07-01', return_date: '2026-07-03',
        rental_fee: RENTAL_FEE, security_deposit: 0, service_fee: SERVICE_FEE,
        protection_fee: 0, delivery_fee: 0, total_amount: TOTAL,
        status: 'completed', payment_status: 'paid', payment_method: 'qrph',
        service_fee_bps: 500,
      }),
    })
    const bookingId = bookingRows?.[0]?.id
    if (!bookingId) throw new Error('booking insert failed: ' + JSON.stringify(bookingRows))
    created.bookings.push(bookingId)
    const bookingRef = bookingRows[0].booking_ref

    // Independently confirm what payouts_owed() says is owed, so the error
    // message assertions below are checked against the real RPC's number, not
    // a value this script merely assumes.
    const { body: owedRows } = await admin('rpc/payouts_owed', { method: 'POST', body: JSON.stringify({ p_host_id: HOST.id }) })
    const owed = owedRows?.[0]
    check('setup: payouts_owed() reports the booking as owed', owed?.amount === PAYABLE && owed?.bookings === 1, JSON.stringify(owedRows))

    const adminSession = await signInFull(ADMIN_EMAIL, ADMIN_PASSWORD)
    const adminCookie = cookieHeaderFor(adminSession)

    // ── 1. Refusal — owed money blocks both routes, amount named exactly ──
    {
      const self = await del(HOST.cookie, '/api/account/delete', { confirm: 'DELETE' })
      check('1. self-service delete refused (400) while money is owed', self.status === 400, `HTTP ${self.status} ${JSON.stringify(self.body)}`)
      check(
        `1. self-service refusal names the exact amount (${peso(PAYABLE)})`,
        self.body?.error === `Rentivo still owes you ${peso(PAYABLE)}. It must be paid out before your account can be deleted.`,
        self.body?.error
      )

      const asAdmin = await del(adminCookie, `/api/admin/users/${HOST.id}/delete`, { confirm: 'DELETE' })
      check('1. admin route refused (400) while money is owed — no override', asAdmin.status === 400, `HTTP ${asAdmin.status} ${JSON.stringify(asAdmin.body)}`)
      check(
        `1. admin refusal names the exact amount (${peso(PAYABLE)})`,
        asAdmin.body?.error === `Rentivo still owes this account ${peso(PAYABLE)}. It must be paid out first.`,
        asAdmin.body?.error
      )
    }

    // ── 2. Control — a COMMITTED draft statement clears the owed gate and
    //    blocks with the draft-statement gate instead, on both routes ──────
    let draftId
    {
      const { body: acctRows } = await admin('payout_accounts', {
        method: 'POST',
        body: JSON.stringify({
          user_id: HOST.id, method: 'GCash', account_number: '09171234567',
          account_name: 'Probe C6 Host Original', status: 'verified',
        }),
      })
      if (!acctRows?.[0]?.id) throw new Error('payout_accounts insert failed: ' + JSON.stringify(acctRows))

      const { status: draftStatus, body: draftBody } = await admin('rpc/create_payout_statement', {
        method: 'POST',
        body: JSON.stringify({ p_host_id: HOST.id, p_expected_amount: PAYABLE, p_admin_email: 'probe-c6-admin@example.com' }),
      })
      const draftRow = Array.isArray(draftBody) ? draftBody[0] : draftBody
      draftId = draftRow?.id
      check('2. create_payout_statement committed a real draft', draftStatus >= 200 && draftStatus < 300 && !!draftId, `HTTP ${draftStatus} ${JSON.stringify(draftBody)}`)
      check('2. the draft is pending, unnumbered', draftRow?.status === 'pending' && draftRow?.statement_number === null, JSON.stringify(draftRow))

      const { body: owedNow } = await admin('rpc/payouts_owed', { method: 'POST', body: JSON.stringify({ p_host_id: HOST.id }) })
      check('2. payouts_owed() is now 0 — the booking is claimed by the draft', (owedNow ?? []).length === 0, JSON.stringify(owedNow))

      const self = await del(HOST.cookie, '/api/account/delete', { confirm: 'DELETE' })
      check('2. self-service delete now refused by the DRAFT gate, not owed', self.status === 400, `HTTP ${self.status} ${JSON.stringify(self.body)}`)
      check(
        '2. self-service draft-gate message',
        self.body?.error === 'You have a draft payout statement in progress. Please wait for it to be recorded or cancelled before deleting your account.',
        self.body?.error
      )

      const asAdmin = await del(adminCookie, `/api/admin/users/${HOST.id}/delete`, { confirm: 'DELETE' })
      check('2. admin route also refused by the DRAFT gate — no override', asAdmin.status === 400, `HTTP ${asAdmin.status} ${JSON.stringify(asAdmin.body)}`)
      check(
        '2. admin draft-gate message',
        asAdmin.body?.error === 'This account has a draft payout statement. It must be recorded or cancelled first.',
        asAdmin.body?.error
      )
    }

    // ── 3. Control — cancel the draft, cancel the booking → nothing owed,
    //    deletion succeeds ─────────────────────────────────────────────────
    {
      const { status: cancelStatus, body: cancelBody } = await admin('rpc/cancel_payout_statement', {
        method: 'POST',
        body: JSON.stringify({ p_request_id: draftId, p_reason: 'verification cleanup (task C6)', p_admin_email: 'probe-c6-admin@example.com' }),
      })
      const cancelRow = Array.isArray(cancelBody) ? cancelBody[0] : cancelBody
      check('3. draft cancelled', cancelStatus >= 200 && cancelStatus < 300 && cancelRow?.status === 'failed' && cancelRow?.statement_number === null, `HTTP ${cancelStatus} ${JSON.stringify(cancelBody)}`)

      // Cancelling a booking directly bypasses enforce_booking_transition
      // (auth.uid() is null for the service role — 077) and only affects this
      // throwaway booking, never the forbidden real one.
      const { status: cxStatus } = await admin(`bookings?id=eq.${bookingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      })
      check('3. booking marked cancelled', cxStatus >= 200 && cxStatus < 300, `HTTP ${cxStatus}`)

      const { body: owedFinal } = await admin('rpc/payouts_owed', { method: 'POST', body: JSON.stringify({ p_host_id: HOST.id }) })
      check('3. payouts_owed() is 0 — the booking is no longer completed', (owedFinal ?? []).length === 0, JSON.stringify(owedFinal))

      // ── Seed the snapshot-scrub fixture BEFORE the real deletion, directly
      //    (never via issue_payout_statement — that would burn a real gapless
      //    number). Its number is deliberately outside the live series. ──────
      const { body: [existingCounter] } = await admin('payout_statement_counters?select=year,last_number&year=eq.2026')
      check(
        `3. fixture number ${FAKE_STATEMENT_NUMBER} is outside the live counter (${existingCounter?.last_number ?? 0})`,
        999999 > (existingCounter?.last_number ?? 0),
        `counter=${existingCounter?.last_number}`
      )

      const { body: [acct] } = await admin(`payout_accounts?select=id&user_id=eq.${HOST.id}`)
      const { status: fakeStatus, body: fakeBody } = await admin('payout_requests', {
        method: 'POST',
        body: JSON.stringify({
          host_id: HOST.id, payout_account_id: acct.id, amount: PAYABLE, status: 'paid',
          statement_number: FAKE_STATEMENT_NUMBER, reference: 'PROBE-C6-FAKE-REF',
          transferred_on: '2026-07-05', processed_at: '2026-07-05T00:00:00+08:00',
          account_method: 'GCash', account_name: 'Probe C6 Host Original', account_number: '09171234567',
        }),
      })
      fakeRequestId = fakeBody?.[0]?.id
      check('3. fixture issued-statement row seeded directly (not via issue_payout_statement)', fakeStatus >= 200 && fakeStatus < 300 && !!fakeRequestId, `HTTP ${fakeStatus} ${JSON.stringify(fakeBody)}`)

      const { status: itemStatus } = await admin('payout_items', {
        method: 'POST',
        body: JSON.stringify({
          payout_request_id: fakeRequestId, booking_id: bookingId, amount: PAYABLE,
          booking_ref: bookingRef, listing_title: 'Probe C6 Deletion Lens',
          pickup_date: '2026-07-01', return_date: '2026-07-03',
          rental_fee: RENTAL_FEE, delivery_fee: 0, service_fee: SERVICE_FEE, service_fee_bps: 500,
        }),
      })
      check('3. fixture payout_items row seeded', itemStatus >= 200 && itemStatus < 300, `HTTP ${itemStatus}`)

      const self = await del(HOST.cookie, '/api/account/delete', { confirm: 'DELETE' })
      check('3. self-service delete now succeeds (200) — nothing owed, no draft', self.status === 200, `HTTP ${self.status} ${JSON.stringify(self.body)}`)
    }

    // ── 4. Snapshot scrub — the fixture row's account is anonymized, its
    //    money fields and payout_items are untouched ─────────────────────
    {
      const { body: [scrubbed] } = await admin(
        `payout_requests?select=account_name,account_number,statement_number,amount,reference,transferred_on&id=eq.${fakeRequestId}`
      )
      check('4. account_name anonymized to "Deleted User"', scrubbed?.account_name === 'Deleted User', scrubbed?.account_name)
      check('4. account_number reduced to its last four digits ("4567")', scrubbed?.account_number === '4567', scrubbed?.account_number)
      check(
        '4. statement_number / amount / reference / transferred_on unchanged',
        scrubbed?.statement_number === FAKE_STATEMENT_NUMBER &&
          scrubbed?.amount === PAYABLE &&
          scrubbed?.reference === 'PROBE-C6-FAKE-REF' &&
          scrubbed?.transferred_on === '2026-07-05',
        JSON.stringify(scrubbed)
      )

      const { body: [item] } = await admin(
        `payout_items?select=booking_ref,listing_title,pickup_date,return_date,rental_fee,delivery_fee,service_fee,service_fee_bps,amount&payout_request_id=eq.${fakeRequestId}`
      )
      check(
        '4. payout_items row (incl. listing_title) unchanged',
        item?.booking_ref === bookingRef &&
          item?.listing_title === 'Probe C6 Deletion Lens' &&
          item?.pickup_date === '2026-07-01' &&
          item?.return_date === '2026-07-03' &&
          item?.rental_fee === RENTAL_FEE &&
          item?.delivery_fee === 0 &&
          item?.service_fee === SERVICE_FEE &&
          item?.service_fee_bps === 500 &&
          item?.amount === PAYABLE,
        JSON.stringify(item)
      )

      const { body: [profile] } = await admin(`profiles?select=full_name,is_host,is_verified&id=eq.${HOST.id}`)
      check('4. profile anonymized', profile?.full_name === 'Deleted User' && profile?.is_host === false && profile?.is_verified === false, JSON.stringify(profile))
      const authAfter = await getAuthUser(HOST.id)
      check('4. auth user soft-deleted (deleted_at set, row still present)', Boolean(authAfter?.deleted_at), JSON.stringify(authAfter?.deleted_at))

      const relogin = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: HOST.email, password: 'ProbeRentivo1' }),
      })
      check('4. login now fails for the deleted host', relogin.status !== 200, `HTTP ${relogin.status}`)
    }

    // ── Delete the seeded fixture row and re-read to prove it is gone ─────
    {
      const { status: delStatus } = await admin(`payout_requests?id=eq.${fakeRequestId}`, { method: 'DELETE' })
      check('cleanup: fixture payout_requests row deleted', delStatus >= 200 && delStatus < 300, `HTTP ${delStatus}`)
      const { body: goneReq } = await admin(`payout_requests?select=id&id=eq.${fakeRequestId}`)
      check('cleanup: fixture payout_requests row confirmed gone', goneReq.length === 0, `${goneReq.length} rows`)
      const { body: goneItems } = await admin(`payout_items?select=payout_request_id&payout_request_id=eq.${fakeRequestId}`)
      check('cleanup: its payout_items row cascaded away', goneItems.length === 0, `${goneItems.length} rows`)
      fakeRequestId = null
    }

    // ── The counter was never touched by any of this ──────────────────────
    {
      const { body: [counterAfter] } = await admin('payout_statement_counters?select=year,last_number&year=eq.2026')
      check(
        'payout_statement_counters (2026) unchanged by this run',
        (counterAfter?.last_number ?? 0) === (counterBefore?.last_number ?? 0),
        `before=${counterBefore?.last_number} after=${counterAfter?.last_number}`
      )
    }
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────
    if (fakeRequestId) await admin(`payout_requests?id=eq.${fakeRequestId}`, { method: 'DELETE' })
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
      await admin(`admin_actions?target_user_id=eq.${u}`, { method: 'DELETE' })
    }
    for (const l of created.listings) {
      await admin(`availability_blocks?listing_id=eq.${l}`, { method: 'DELETE' })
      await admin(`listings?id=eq.${l}`, { method: 'DELETE' })
    }
    for (const u of created.users) {
      await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
      await hardDeleteUser(u)
    }

    // ── Baselines re-checked ────────────────────────────────────────────
    const countOf = async (table, col = 'id') => (await admin(`${table}?select=${col}`)).body.length
    const after = {
      bookings: await countOf('bookings'),
      payout_requests: await countOf('payout_requests'),
      payout_items: await countOf('payout_items', 'booking_id'),
      payout_accounts: await countOf('payout_accounts'),
      admin_actions: await countOf('admin_actions'),
      notifications: await countOf('notifications'),
      listings: await countOf('listings'),
      profiles: await countOf('profiles'),
    }
    for (const key of Object.keys(before)) {
      check(`baseline: ${key} unchanged (${before[key]})`, before[key] === after[key], `before=${before[key]} after=${after[key]}`)
    }

    const { body: [forbiddenHostAfter] } = await admin(`profiles?select=id,full_name,suspended_at&id=eq.${FORBIDDEN_HOST}`)
    check(
      'forbidden host untouched',
      JSON.stringify(forbiddenHostAfter) === JSON.stringify(forbiddenHostBefore),
      `before=${JSON.stringify(forbiddenHostBefore)} after=${JSON.stringify(forbiddenHostAfter)}`
    )
    const { body: [forbiddenBookingAfter] } = await admin(`bookings?select=id,status,payment_status&booking_ref=eq.${FORBIDDEN_BOOKING_REF}`)
    check(
      'forbidden booking untouched',
      JSON.stringify(forbiddenBookingAfter) === JSON.stringify(forbiddenBookingBefore),
      `before=${JSON.stringify(forbiddenBookingBefore)} after=${JSON.stringify(forbiddenBookingAfter)}`
    )
  }
}

main().then(done).catch((e) => {
  console.error(e)
  process.exit(1)
})
