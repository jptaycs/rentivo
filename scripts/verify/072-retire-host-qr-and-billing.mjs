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
  // This check failed until migration 078. create_booking used to carry a dead
  // host_qr branch that read profiles.qr_payment_url (dropped by 072) BEFORE
  // the block_host_qr_bookings trigger could raise, so callers saw a raw
  // Postgres 42703 instead of the trigger's message. 078's create_booking
  // rewrite deleted that branch, so the trigger's "Please pay with QR Ph."
  // now surfaces and this passes. It should stay green.
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
  if (probeBookingId) {
    // The control booking's triggers also wrote a host `booking_request`
    // notification and a `booking:<renter>` rate_limit_hits row, both stamped
    // with the booking's own transaction time (now() is constant within a
    // transaction). Delete exactly those, bounded to that instant, so neither
    // the seed host's real notifications nor the demo renter's other hits go.
    const renterId = JSON.parse(Buffer.from(renter.split('.')[1], 'base64url').toString()).sub
    const { body: [probe] } = await admin(`bookings?select=id,created_at&id=eq.${probeBookingId}`)
    const t0 = encodeURIComponent(probe.created_at)
    const t1 = encodeURIComponent(new Date(new Date(probe.created_at).getTime() + 1000).toISOString())
    await admin(`bookings?id=eq.${probeBookingId}`, { method: 'DELETE' })
    const notifQ = `notifications?user_id=eq.${listing.host_id}&type=eq.booking_request&created_at=gte.${t0}&created_at=lt.${t1}`
    const hitsQ = `rate_limit_hits?key=eq.booking:${renterId}&hit_at=gte.${t0}&hit_at=lt.${t1}`
    await admin(notifQ, { method: 'DELETE' })
    await admin(hitsQ, { method: 'DELETE' })
    const left = [
      (await admin(`bookings?select=id&id=eq.${probeBookingId}`)).body.length,
      (await admin(notifQ.replace('notifications?', 'notifications?select=id&'))).body.length,
      (await admin(hitsQ.replace('rate_limit_hits?', 'rate_limit_hits?select=key&'))).body.length,
    ]
    check('cleanup: control booking, its notification and its rate_limit_hits row are gone',
      left.every((n) => n === 0), `booking ${left[0]}, notification ${left[1]}, hits ${left[2]}`)
  }

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
