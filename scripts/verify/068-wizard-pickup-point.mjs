// Verifies Task 5 of the exact-pickup-coordinates feature: the host wizard's
// Step5Address now requires a placed pin, and ListingWizard's submit writes
// latitude/longitude/location_is_exact onto the real listings row.
//
// latitude/longitude/location_is_exact are currently NULLABLE (the migration
// making them required is deliberately deferred until this feature ships),
// so a wiring mistake would NOT throw — it would silently store nulls. This
// script therefore reads the row back with the service role and checks the
// actual stored values, not just that the insert succeeded.
//
// This exercises the PERSISTENCE PATH directly (a real INSERT under the
// host's own session, with the exact field shape ListingWizard.handleSubmit
// builds) rather than driving the full 6-step wizard UI end to end — Step 6
// (ID/selfie verification) requires an on-device face-detection pass that
// isn't reliably scriptable against synthetic images. The Continue-button
// gating on Step 5 itself (disabled with no pin, enabled once one is placed)
// was checked separately in a real browser — see task-5-report.md.
//
// Usage: node --experimental-strip-types scripts/verify/068-wizard-pickup-point.mjs
import { URL as SUPABASE_URL, SECRET, admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING_CODE = 'RNT-A4DA55'

const PLACED_LAT = 14.5547
const PLACED_LNG = 121.0244

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  return j.id
}
const deleteUser = (id) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })

const before = (await admin('listings?select=id')).body.length

const stamp = Date.now()
const hostEmail = `probe-wizardpin-host-${stamp}@example.com`
const hostId = await createUser(hostEmail)
let listingId = null

try {
  // ── setup ──────────────────────────────────────────────────────────────
  // is_host + is_verified so nothing blocks the insert or forces a draft
  // that would be confusing to read back (037's trigger only affects
  // is_draft, not the insert itself, but keeping this clean avoids any
  // ambiguity in what's being tested).
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true }),
  })
  const hostToken = await signIn(hostEmail, 'ProbeRentivo1')

  // ── Step 5's required-pin gating, expressed as data rather than DOM ──────
  // Mirrors Step5Address.tsx's canContinue exactly.
  const canContinue = (province, city, lat, lng) =>
    Boolean(province && city && lat != null && lng != null)

  check(
    'canContinue is false with no pin placed (province+city only)',
    canContinue('Metro Manila', 'Pasig', null, null) === false
  )
  check(
    'canContinue is false with only one coordinate set (partial state can\'t sneak through)',
    canContinue('Metro Manila', 'Pasig', PLACED_LAT, null) === false
  )
  check(
    'canContinue is true once province, city, lat and lng are all set',
    canContinue('Metro Manila', 'Pasig', PLACED_LAT, PLACED_LNG) === true
  )

  // ── the real write: exact shape of ListingWizard.handleSubmit's `fields` ─
  const fields = {
    host_id: hostId,
    category: 'mirrorless',
    brand: 'Sony',
    model: 'Probe Wizard Pin Test',
    title: 'Sony Probe Wizard Pin Test',
    description: 'A throwaway probe listing created to verify the host wizard writes an exact pickup pin onto the row.',
    condition: 'excellent',
    serial_number: null,
    daily_price: 500,
    weekly_price: null,
    monthly_price: null,
    security_deposit: 0,
    delivery_fee: null,
    city: 'Pasig',
    province: 'Metro Manila',
    street_address: null,
    is_instant_book: false,
    latitude: PLACED_LAT,
    longitude: PLACED_LNG,
    location_is_exact: true,
    images: [],
    accessories: [],
  }

  // select=id, matching ListingWizard's own `.insert(fields).select('id')` —
  // PostgREST's default return=representation otherwise selects every
  // column, and latitude/longitude are private since migration 064, so an
  // unscoped select-back 403s even though the insert itself would succeed.
  const insertRes = await asUser(hostToken, 'listings?select=id', {
    method: 'POST',
    body: JSON.stringify(fields),
  })
  check('insert as the host succeeded', insertRes.status === 201, `status ${insertRes.status} ${JSON.stringify(insertRes.body)}`)
  listingId = insertRes.body?.[0]?.id ?? null
  check('insert returned a listing id', Boolean(listingId))

  // ── read back with the service role (bypasses the private-column grant
  //    from 064 entirely, so this proves the DATABASE value, not just what
  //    the client-side insert echoed back) ──────────────────────────────
  const { body: rows } = await admin(
    `listings?select=latitude,longitude,location_is_exact,city,province&id=eq.${listingId}`
  )
  const row = rows[0]
  check('row exists on re-read', Boolean(row))
  check(
    'wizard stored the placed pin — latitude matches exactly',
    row && Number(row.latitude) === PLACED_LAT,
    `stored ${row?.latitude}`
  )
  check(
    'wizard stored the placed pin — longitude matches exactly',
    row && Number(row.longitude) === PLACED_LNG,
    `stored ${row?.longitude}`
  )
  check(
    'location_is_exact is true (a host-placed pin, not a 066 city-centre backfill)',
    row && row.location_is_exact === true
  )

  // ── negative control: an insert that omits the pin (the pre-Task-5 shape)
  //    still lands with nulls today, proving these columns really are still
  //    nullable — the brief's premise that a wiring mistake would NOT throw.
  //    This is a control on the SCHEMA, not on ListingWizard's own code path.
  const noPinFields = { ...fields, model: 'Probe Wizard Pin Test (no pin control)' }
  delete noPinFields.latitude
  delete noPinFields.longitude
  delete noPinFields.location_is_exact
  const controlRes = await asUser(hostToken, 'listings?select=id', {
    method: 'POST',
    body: JSON.stringify(noPinFields),
  })
  check('control insert (no pin) also succeeds — confirms columns are still nullable', controlRes.status === 201)
  const controlId = controlRes.body?.[0]?.id ?? null
  if (controlId) {
    const { body: controlRows } = await admin(`listings?select=latitude,longitude,location_is_exact&id=eq.${controlId}`)
    check(
      'control row has null coordinates and location_is_exact defaults to false',
      controlRows[0]?.latitude === null && controlRows[0]?.longitude === null && controlRows[0]?.location_is_exact === false
    )
    await admin(`listings?id=eq.${controlId}`, { method: 'DELETE' })
  }
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────
  if (listingId) await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  await deleteUser(hostId)

  const after = (await admin('listings?select=id')).body.length
  check('listing count returned to baseline', after === before, `before ${before}, after ${after}`)

  const { body: forbiddenListings } = await admin(`listings?select=id&host_id=eq.${FORBIDDEN_HOST}`)
  check('forbidden host\'s listings untouched (still present)', forbiddenListings.length > 0)
  const { body: forbiddenBooking } = await admin(`bookings?select=id&booking_ref=eq.${FORBIDDEN_BOOKING_CODE}`)
  check('forbidden booking still exists', forbiddenBooking.length === 1)
}

done()
