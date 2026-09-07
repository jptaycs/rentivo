// Proves create_booking no longer charges the security deposit, and that
// already-charged bookings keep their historical amounts.
//
// Usage: node --experimental-strip-types scripts/verify/070-deposit-not-charged.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const stamp = Date.now()
const created = { users: [], listings: [], bookings: [] }

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  return j.id
}
const hardDeleteUser = (id) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1' }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('signIn: ' + JSON.stringify(j))
  return j.access_token
}

async function main() {
  const { body: bookingsBefore } = await admin('bookings?select=id')

  const hostId = await createUser(`probe-dep-host-${stamp}@example.com`)
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe Deposit Host', is_host: true, is_verified: true }),
  })
  const renterId = await createUser(`probe-dep-renter-${stamp}@example.com`)
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH', body: JSON.stringify({ full_name: 'Probe Deposit Renter' }),
  })

  // Deliberately non-zero deposit and non-zero delivery fee: this listing can
  // tell "deposit excluded" apart from "everything except rental excluded".
  const { body: listingRows } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId,
      title: `Probe Deposit Listing ${stamp}`,
      brand: 'Sony', model: 'A7 IV', category: 'mirrorless', condition: 'excellent',
      description: 'Probe listing for deposit-removal verification.',
      daily_price: 1000, security_deposit: 7000, delivery_fee: 350,
      city: 'Manila', province: 'Metro Manila',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false,
      latitude: 14.5995, longitude: 120.9842, location_is_exact: true,
    }),
  })
  const listingId = listingRows[0].id
  created.listings.push(listingId)

  const token = await signIn(`probe-dep-renter-${stamp}@example.com`)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_listing_id: listingId,
      p_pickup_date: '2027-04-01', p_return_date: '2027-04-03',
      p_is_delivery: true, p_delivery_address: 'Probe address',
      p_payment_method: 'qrph', p_promo_code: null, p_renter_notes: null,
    }),
  })
  const b = await res.json()
  if (b?.id) created.bookings.push(b.id)
  check('booking created', res.status === 200 && Boolean(b?.id), JSON.stringify(b).slice(0, 200))

  // 2 days x P1000 = P2000 rental; 5% service = P100; delivery P350.
  check('rental_fee is 2000', b.rental_fee === 2000, String(b.rental_fee))
  check('service_fee is 100 (5% of rental only)', b.service_fee === 100, String(b.service_fee))
  check('delivery_fee is 350', b.delivery_fee === 350, String(b.delivery_fee))
  check('security_deposit stored as 0', b.security_deposit === 0, String(b.security_deposit))
  check('total_amount is 2450 (deposit NOT included)', b.total_amount === 2450, String(b.total_amount))
  check('total equals rental + service + delivery exactly',
    b.total_amount === b.rental_fee + b.service_fee + b.delivery_fee)
  check('listing still declares its deposit', listingRows[0].security_deposit === 7000)

  // Historical bookings must keep their real charged amounts.
  const { body: historical } = await admin(
    'bookings?select=booking_ref,security_deposit,total_amount&booking_ref=eq.RNT-89459E'
  )
  check('pre-070 booking keeps its historical deposit',
    historical?.[0]?.security_deposit === 10000, JSON.stringify(historical?.[0] ?? null))

  for (const x of created.bookings) await admin(`bookings?id=eq.${x}`, { method: 'DELETE' })
  for (const x of created.listings) await admin(`listings?id=eq.${x}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }

  const { body: bookingsAfter } = await admin('bookings?select=id')
  check('bookings count back at baseline', bookingsAfter.length === bookingsBefore.length,
    `${bookingsBefore.length} -> ${bookingsAfter.length}`)
  const { body: forbidden } = await admin(
    `bookings?booking_ref=eq.RNT-A4DA55&select=total_amount,host_id`)
  check('forbidden booking untouched',
    forbidden?.[0]?.total_amount === 1510 && forbidden?.[0]?.host_id === FORBIDDEN_HOST)
  done()
}

main().catch(async (err) => {
  console.error('\nSCRIPT ERROR:', err.message)
  for (const x of created.bookings) await admin(`bookings?id=eq.${x}`, { method: 'DELETE' })
  for (const x of created.listings) await admin(`listings?id=eq.${x}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }
  process.exit(1)
})
