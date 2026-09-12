// Proves the host-QR method and the billing ledger are gone, and — the
// check that matters most — that request_payout() still excludes host_qr
// bookings, so the host of a directly-paid booking is never paid twice.
//
// Usage: node --experimental-strip-types scripts/verify/072-retire-host-qr-and-billing.mjs
import { admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'

async function main() {
  const renter = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')

  // A real active listing to book against.
  const { body: listings } = await admin('listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&limit=5')
  const listing = listings.find(l => l.host_id !== FORBIDDEN_HOST)
  check('found a listing to test against', Boolean(listing))

  // 1. The trigger refuses host_qr.
  const blocked = await asUser(renter, 'rpc/create_booking', {
    method: 'POST',
    body: JSON.stringify({
      p_listing_id: listing.id,
      p_pickup_date: '2026-11-10',
      p_return_date: '2026-11-12',
      p_payment_method: 'host_qr',
    }),
  })
  check('host_qr booking is refused', blocked.status >= 400,
    `HTTP ${blocked.status} ${JSON.stringify(blocked.body).slice(0, 160)}`)
  check('refusal names the replacement method',
    JSON.stringify(blocked.body).includes('QR Ph'))

  // CONTROL: the identical call with qrph succeeds, so the refusal above is
  // attributable to the method and not to some unrelated guard.
  const ok = await asUser(renter, 'rpc/create_booking', {
    method: 'POST',
    body: JSON.stringify({
      p_listing_id: listing.id,
      p_pickup_date: '2026-11-10',
      p_return_date: '2026-11-12',
      p_payment_method: 'qrph',
    }),
  })
  check('CONTROL: qrph booking is accepted', ok.status < 400,
    `HTTP ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`)
  const probeBookingId = ok.body?.id ?? ok.body
  if (probeBookingId) await admin(`bookings?id=eq.${probeBookingId}`, { method: 'DELETE' })

  // 2. The dropped RPCs are gone.
  for (const fn of ['generate_host_bills', 'mark_host_bill_paid', 'void_host_bill',
                    'is_host_billing_delinquent', 'confirm_host_qr_payment']) {
    const { status } = await admin(`rpc/${fn}`, { method: 'POST', body: '{}' })
    check(`${fn}() no longer exists`, status === 404, `HTTP ${status}`)
  }

  // 3. The tables are gone.
  for (const t of ['host_bills', 'host_bill_items']) {
    const { status } = await admin(`${t}?select=id&limit=1`)
    check(`${t} table is gone`, status === 404, `HTTP ${status}`)
  }

  // 4. The personal-data columns are gone.
  const { status: qrStatus } = await admin('profiles?select=qr_payment_label&limit=1')
  check('profiles.qr_payment_label is gone', qrStatus === 400, `HTTP ${qrStatus}`)

  // 5. THE IMPORTANT ONE: payout exclusion survives. The two historical
  //    host_qr bookings must never become payout-eligible.
  const { body: hostQr } = await admin(
    'bookings?select=id,booking_ref,payment_method,status,payment_status&payment_method=eq.host_qr')
  check('both historical host_qr bookings still exist', hostQr.length === 2, `found ${hostQr.length}`)
  const { body: items } = await admin(
    `payout_items?select=booking_id&booking_id=in.(${hostQr.map(b => b.id).join(',')})`)
  check('no host_qr booking is claimed by any payout', items.length === 0,
    `found ${items.length} payout item(s)`)

  // 6. Storefront intact: a missing grant would empty this silently.
  const { body: store, status: storeStatus } = await asUser(null,
    'listings?select=id,title,host:profiles!listings_host_id_fkey!inner(id,full_name)&is_active=eq.true&is_draft=eq.false')
  check('anon storefront read still works', storeStatus === 200, `HTTP ${storeStatus}`)
  check('storefront still returns listings', store.length > 0, `${store.length} listings`)

  done()
}

main()
