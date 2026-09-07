// Proves the per-row Suspend / Un-suspend / Delete actions on /admin/users
// drive the SAME routes and the SAME effects as the detail page's UserActions,
// and that the row-state logic gates them correctly.
//
// The component is client-side, so what this script verifies is the pair that
// actually matters: (a) the server page renders the right affordance for each
// row state, read off the real HTML, and (b) the routes those buttons POST to
// produce the real effects (listings hidden, login banned, profile anonymized)
// when called exactly as the component calls them.
//
// Throwaway accounts only. The real host and booking AGENTS.md marks as
// off-limits are re-read at the end and asserted untouched.
//
// Usage: node --experimental-strip-types scripts/verify/admin-users-row-actions.mjs [appUrl]
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING = 'RNT-A4DA55'
// Drive the panel as the DEMO host, which .env.local includes on the local
// allowlist precisely so e2e can reach /admin (AGENTS.md). The owner's own
// Gmail is also allowlisted but this script has no password for it — and
// shouldn't.
const ADMIN_EMAIL = 'demo@demo.rentivo.ph'
const ADMIN_PASSWORD = 'DemoRentivo1'
const ALLOWLIST = (process.env.ADMIN_EMAILS ?? '').toLowerCase()

const stamp = Date.now()
const created = { users: [], listings: [], bookings: [] }

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
async function createUser(email, meta = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true, ...meta }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  return j.id
}
const hardDeleteUser = (id) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
const getAuthUser = async (id) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
  return res.json()
}
const isBanned = (b) => {
  if (!b) return false
  const t = Date.parse(b)
  return Number.isFinite(t) && t > Date.now()
}
/** POST exactly as RowActions does. */
const act = async (cookie, id, path, body) => {
  const res = await fetch(`${APP}/api/admin/users/${id}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
/** The one <tr> for this user, from the real rendered list page. */
async function rowFor(cookie, userId) {
  const res = await fetch(`${APP}/admin/users`, { headers: { Cookie: cookie } })
  const html = await res.text()
  const rows = html.split('<tr').filter((r) => r.includes(userId))
  return { status: res.status, row: rows[0] ?? '' }
}

async function main() {
  // AGENTS.md records a real incident where this variable was missing locally
  // and every admin case failed as an indistinguishable 404. Fail loudly here.
  if (!ALLOWLIST.includes(ADMIN_EMAIL))
    throw new Error(
      `ADMIN_EMAILS in .env.local does not include ${ADMIN_EMAIL} — /admin would 404 for it. See AGENTS.md.`
    )

  // --- baseline -----------------------------------------------------------
  const { body: profilesBefore } = await admin('profiles?select=id')
  const { body: listingsBefore } = await admin('listings?select=id')
  const { body: bookingsBefore } = await admin('bookings?select=id')

  // --- an admin session to drive the panel with ----------------------------
  const adminSession = await signInFull(ADMIN_EMAIL, ADMIN_PASSWORD)
  const adminCookie = cookieHeaderFor(adminSession)

  const listRes = await fetch(`${APP}/admin/users`, { headers: { Cookie: adminCookie } })
  check('admin can load /admin/users', listRes.status === 200, `HTTP ${listRes.status}`)

  // --- a throwaway host with a live listing -------------------------------
  const hostEmail = `probe-rowactions-${stamp}@example.com`
  const hostId = await createUser(hostEmail)
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe RowActions Host', is_host: true, is_verified: true }),
  })
  const { body: listingRows } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId,
      title: `Probe RowActions Listing ${stamp}`,
      brand: 'Sony', model: 'A7 IV', category: 'mirrorless', condition: 'excellent',
      description: 'Probe listing for admin row actions verification.',
      daily_price: 1000, security_deposit: 5000,
      city: 'Manila', province: 'Metro Manila',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false,
      latitude: 14.5995, longitude: 120.9842, location_is_exact: true,
    }),
  })
  const listingId = listingRows?.[0]?.id
  if (!listingId) throw new Error('listing insert failed: ' + JSON.stringify(listingRows))
  created.listings.push(listingId)

  const visibleToAnon = async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?select=id&id=eq.${listingId}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
    )
    return (await res.json()).length
  }
  check('probe listing is publicly visible before suspend', (await visibleToAnon()) === 1)

  // --- ACTIVE row: offers Suspend + Delete, not Un-suspend ----------------
  {
    const { row } = await rowFor(adminCookie, hostId)
    check('active row offers Suspend', row.includes('>Suspend<'))
    check('active row offers Delete', row.includes('>Delete<'))
    check('active row does NOT offer Un-suspend', !row.includes('Un-suspend'))
    check('active row is not flagged "Needs attention"', !row.includes('Needs attention'))
  }

  // --- suspend, exactly as the dialog posts it ----------------------------
  const reason = 'Probe suspension from the users list.'
  const susp = await act(adminCookie, hostId, 'suspend', { reason })
  check('suspend returns 200', susp.status === 200, `HTTP ${susp.status}`)

  const { body: afterSuspend } = await admin(`profiles?id=eq.${hostId}&select=suspended_at`)
  check('profiles.suspended_at is set', afterSuspend?.[0]?.suspended_at !== null)
  check('GoTrue ban is in place', isBanned((await getAuthUser(hostId)).banned_until))
  check('listing is hidden from the public after suspend', (await visibleToAnon()) === 0)

  const { body: auditRows } = await admin(
    `admin_actions?select=action,detail&target_user_id=eq.${hostId}&order=created_at.desc`
  )
  check('an admin_actions audit row was written', (auditRows ?? []).length > 0)
  check(
    'audit row carries the reason the dialog sent',
    JSON.stringify(auditRows?.[0]?.detail ?? {}).includes(reason)
  )

  // --- SUSPENDED row: offers Un-suspend, not Suspend ----------------------
  {
    const { row } = await rowFor(adminCookie, hostId)
    check('suspended row offers Un-suspend', row.includes('Un-suspend'))
    check('suspended row still offers Delete', row.includes('>Delete<'))
    check('suspended row does NOT offer Suspend', !row.includes('>Suspend<'))
  }

  // --- suspend requires a reason (the dialog disables the button; the route
  //     is what actually enforces it) ---------------------------------------
  const noReason = await act(adminCookie, hostId, 'suspend', { reason: '   ' })
  check('suspend with a whitespace-only reason is refused', noReason.status === 400,
    `HTTP ${noReason.status}`)

  // --- un-suspend ---------------------------------------------------------
  const unsusp = await act(adminCookie, hostId, 'unsuspend')
  check('un-suspend returns 200', unsusp.status === 200, `HTTP ${unsusp.status}`)
  const { body: afterUnsuspend } = await admin(`profiles?id=eq.${hostId}&select=suspended_at`)
  check('suspended_at cleared', afterUnsuspend?.[0]?.suspended_at === null)
  check('GoTrue ban lifted', !isBanned((await getAuthUser(hostId)).banned_until))
  check('listing is publicly visible again', (await visibleToAnon()) === 1)

  // --- HALF-APPLIED row: flagged but not banned -> "Needs attention" -------
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ suspended_at: new Date().toISOString() }),
  })
  {
    const { row } = await rowFor(adminCookie, hostId)
    check('half-applied row shows "Needs attention"', row.includes('Needs attention'))
    check('half-applied row offers no inline Suspend', !row.includes('>Suspend<'))
    check('half-applied row offers no inline Delete', !row.includes('>Delete<'))
  }
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH', body: JSON.stringify({ suspended_at: null }),
  })

  // --- ADMIN row: no actions at all ---------------------------------------
  {
    const { body: adminProfile } = await admin(
      `profiles?select=id&id=neq.${hostId}&limit=1`
    )
    const adminUserId = adminSession.user.id
    const { row } = await rowFor(adminCookie, adminUserId)
    check('admin row is labelled Admin', row.includes('>Admin<'), adminProfile ? '' : '')
    check('admin row offers no Suspend', !row.includes('>Suspend<'))
    check('admin row offers no Delete', !row.includes('>Delete<'))
    const refused = await act(adminCookie, adminUserId, 'suspend', { reason: 'should be refused' })
    check('route refuses to suspend an admin', refused.status === 400, `HTTP ${refused.status}`)
  }

  // --- delete is gated by an in-flight booking ----------------------------
  const renterEmail = `probe-rowactions-renter-${stamp}@example.com`
  const renterId = await createUser(renterEmail)
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH', body: JSON.stringify({ full_name: 'Probe RowActions Renter' }),
  })
  const renterSession = await signInFull(renterEmail, 'ProbeRentivo1')
  const bookRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, {
    method: 'POST',
    headers: {
      apikey: ANON, Authorization: `Bearer ${renterSession.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_listing_id: listingId,
      p_pickup_date: '2027-03-01', p_return_date: '2027-03-03',
      p_is_delivery: false, p_delivery_address: null,
      p_payment_method: 'qrph', p_promo_code: null, p_renter_notes: null,
    }),
  })
  // create_booking RETURNS bookings, so PostgREST hands back the whole row —
  // not a bare id. Reading it as a string silently left created.bookings empty,
  // which made the gate check below pass vacuously and stranded probe rows.
  const bookingRow = await bookRes.json()
  if (bookingRow?.id) created.bookings.push(bookingRow.id)
  check('probe booking created for the delete gate',
    bookRes.status === 200 && Boolean(bookingRow?.id),
    `HTTP ${bookRes.status} ${bookingRow?.booking_ref ?? JSON.stringify(bookingRow)}`)

  // Without a real in-flight booking this check passes vacuously (delete just
  // succeeds), so make the precondition itself an assertion.
  check('precondition: an in-flight booking exists to gate on', created.bookings.length === 1)
  const blocked = await act(adminCookie, hostId, 'delete', { confirm: 'DELETE' })
  check('delete is refused while a booking is in flight', blocked.status === 400,
    `HTTP ${blocked.status} ${blocked.body?.error ?? ''}`)

  const wrongConfirm = await act(adminCookie, hostId, 'delete', { confirm: 'delete' })
  check('delete is refused with the wrong confirm text', wrongConfirm.status === 400,
    `HTTP ${wrongConfirm.status}`)

  // clear the gate, then delete for real
  await admin(`bookings?id=eq.${created.bookings[0]}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
  })
  const del = await act(adminCookie, hostId, 'delete', { confirm: 'DELETE' })
  check('delete succeeds once the gate clears', del.status === 200,
    `HTTP ${del.status} ${del.body?.error ?? ''}`)

  const { body: tombstone } = await admin(`profiles?id=eq.${hostId}&select=full_name,is_host`)
  check('profile was anonymized, not removed', (tombstone ?? []).length === 1)
  check('name is a tombstone', tombstone?.[0]?.full_name !== 'Probe RowActions Host',
    `now "${tombstone?.[0]?.full_name}"`)
  const deletedAuth = await getAuthUser(hostId)
  check('auth user is soft-deleted', Boolean(deletedAuth.deleted_at))

  // A soft-deleted user must drop off the list entirely.
  {
    const { row } = await rowFor(adminCookie, hostId)
    check('deleted user no longer appears in the list', row === '')
  }

  // --- cleanup ------------------------------------------------------------
  for (const b of created.bookings) await admin(`bookings?id=eq.${b}`, { method: 'DELETE' })
  for (const l of created.listings) await admin(`listings?id=eq.${l}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`admin_actions?target_user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }

  // --- baseline restored + forbidden data untouched -----------------------
  const { body: profilesAfter } = await admin('profiles?select=id')
  const { body: listingsAfter } = await admin('listings?select=id')
  const { body: bookingsAfter } = await admin('bookings?select=id')
  check('profiles count back at baseline', profilesAfter.length === profilesBefore.length,
    `${profilesBefore.length} -> ${profilesAfter.length}`)
  check('listings count back at baseline', listingsAfter.length === listingsBefore.length,
    `${listingsBefore.length} -> ${listingsAfter.length}`)
  check('bookings count back at baseline', bookingsAfter.length === bookingsBefore.length,
    `${bookingsBefore.length} -> ${bookingsAfter.length}`)

  const { body: forbidden } = await admin(
    `profiles?id=eq.${FORBIDDEN_HOST}&select=id,full_name,suspended_at`
  )
  check('forbidden real host untouched and not suspended',
    forbidden?.[0]?.suspended_at === null && forbidden?.[0]?.full_name === 'Isse Capucao',
    JSON.stringify(forbidden?.[0] ?? null))
  // Assert identity + amount + owner, NOT status: a real booking's status
  // changes for legitimate reasons (this one was accepted 2026-09-02), so a
  // status oracle goes stale and reads as a false alarm. What must never
  // change is that it still exists, for the same money, under the same host.
  const { body: fb } = await admin(
    `bookings?booking_ref=eq.${FORBIDDEN_BOOKING}&select=booking_ref,total_amount,host_id,created_at`
  )
  check('forbidden real booking still present, same amount and host',
    fb?.length === 1 && fb[0].total_amount === 1510 && fb[0].host_id === FORBIDDEN_HOST,
    JSON.stringify(fb?.[0] ?? null))

  done()
}

main().catch(async (err) => {
  console.error('\nSCRIPT ERROR:', err.message)
  for (const b of created.bookings) await admin(`bookings?id=eq.${b}`, { method: 'DELETE' })
  for (const l of created.listings) await admin(`listings?id=eq.${l}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`admin_actions?target_user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }
  process.exit(1)
})
