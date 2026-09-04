// Verifies Task 9 (exact-pickup-coordinates plan): deleting an account
// resets its listings' exact pickup coordinates back to the city centre and
// clears location_is_exact, alongside the pre-existing is_active/street_address
// scrub. Run against a dev server on :3100.
//
// Run: node scripts/verify/069-account-deletion-coordinates.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const FORBIDDEN_BOOKING = 'RNT-A4DA55'

async function signInFull(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json)}`)
  return json
}
function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`).join('; ')
}

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  return j.id
}
async function hardDeleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}?should_soft_delete=false`, {
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}

const before = { listings: (await admin('listings?select=id')).body.length }

const stamp = Date.now()
const hostEmail = `probe-coords-host-${stamp}@example.com`
let hostId = null
let listingId = null

try {
  hostId = await createUser(hostEmail)
  if (hostId === FORBIDDEN_HOST) throw new Error('refuse to touch the forbidden host')

  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Coords Host' }),
  })

  // City centre for Cebu City / Cebu, per ph-locations.ts.
  const { getCityCoordinates } = await import('../../src/lib/ph-locations.ts')
  const cityCentre = getCityCoordinates('Cebu City', 'Cebu')

  // A pin well away from the city centre (~10km+), marked exact.
  const pinLat = cityCentre.lat + 0.15
  const pinLng = cityCentre.lng + 0.15

  const { body: [listing] } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'Coords1',
      title: 'Probe coords listing', description: 'probe', condition: 'good',
      daily_price: 1000, security_deposit: 0, city: 'Cebu City', province: 'Cebu',
      street_address: '123 Probe St, Cebu City', is_instant_book: false, is_active: true, is_draft: false,
      images: [], accessories: [], latitude: pinLat, longitude: pinLng, location_is_exact: true,
    }),
  })
  if (!listing) throw new Error('listing insert failed')
  listingId = listing.id

  check(
    'setup: listing placed with an exact pin away from the city centre',
    listing.location_is_exact === true &&
      Math.abs(Number(listing.latitude) - pinLat) < 1e-9 &&
      Math.abs(Number(listing.longitude) - pinLng) < 1e-9 &&
      listing.street_address === '123 Probe St, Cebu City' &&
      listing.is_active === true
  )

  const session = await signInFull(hostEmail, 'ProbeRentivo1')
  const cookie = cookieHeaderFor(session)

  const res = await fetch(`${APP}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ confirm: 'DELETE' }),
  })
  const body = await res.json().catch(() => ({}))
  check('delete route: 200 ok', res.status === 200 && body.ok === true, `${res.status} ${JSON.stringify(body)}`)

  const { body: [after] } = await admin(`listings?select=*&id=eq.${listingId}`)
  if (!after) throw new Error('listing disappeared after deletion (should be deactivated, not deleted)')

  check(
    'coordinates reset to the city centre',
    Math.abs(Number(after.latitude) - cityCentre.lat) < 1e-6 && Math.abs(Number(after.longitude) - cityCentre.lng) < 1e-6,
    `lat=${after.latitude} lng=${after.longitude} expected lat=${cityCentre.lat} lng=${cityCentre.lng}`
  )
  check('location_is_exact reset to false', after.location_is_exact === false, `${after.location_is_exact}`)
  check('is_active reset to false (pre-existing scrub not regressed)', after.is_active === false, `${after.is_active}`)
  check('street_address nulled (pre-existing scrub not regressed)', after.street_address === null, `${after.street_address}`)

  const { body: [profile] } = await admin(`profiles?select=full_name,is_host&id=eq.${hostId}`)
  check('profile anonymized as a side effect of the same flow', profile?.full_name === 'Deleted User', `${JSON.stringify(profile)}`)
} finally {
  // Cleanup: remove the probe listing and hard-delete the probe auth user
  // (which cascades the anonymized profile row away too), restoring baseline.
  if (listingId) await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  if (hostId) await hardDeleteUser(hostId)
}

const { body: leftoverListing } = await admin(`listings?select=id&id=eq.${listingId}`)
check('probe listing removed', leftoverListing.length === 0)
const { body: leftoverProfile } = await admin(`profiles?select=id&id=eq.${hostId}`)
check('probe profile removed (cascaded by auth hard-delete)', leftoverProfile.length === 0)

const after = { listings: (await admin('listings?select=id')).body.length }
check('listing count restored to baseline', after.listings === before.listings, `before=${before.listings} after=${after.listings}`)

const { body: forbiddenHost } = await admin(`profiles?select=id,full_name&id=eq.${FORBIDDEN_HOST}`)
check('forbidden host untouched', forbiddenHost.length === 1 && forbiddenHost[0].full_name !== 'Deleted User', `${JSON.stringify(forbiddenHost)}`)
const { body: forbiddenBooking } = await admin(`bookings?select=booking_ref&booking_ref=eq.${FORBIDDEN_BOOKING}`)
check('forbidden booking untouched', forbiddenBooking.length === 1, `${JSON.stringify(forbiddenBooking)}`)

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
