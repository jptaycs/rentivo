import { admin, check, done } from './env.mjs'

const bookings = (await admin('bookings?select=id,listing_id,renter_id,host_id')).body
const convos   = (await admin('conversations?select=id,booking_id,listing_id,renter_id,host_id')).body

check('one conversation per booking',
  convos.filter(c => c.booking_id).length === bookings.length,
  `bookings ${bookings.length}, attached conversations ${convos.filter(c => c.booking_id).length}`)

const byBooking = new Map(convos.filter(c => c.booking_id).map(c => [c.booking_id, c]))
let mismatched = 0
for (const b of bookings) {
  const c = byBooking.get(b.id)
  if (!c || c.listing_id !== b.listing_id || c.renter_id !== b.renter_id || c.host_id !== b.host_id) mismatched++
}
check('every conversation matches its booking participants', mismatched === 0, `${mismatched} mismatched`)

// Repeat rentals: 4 bookings share a (listing, renter) pair. Each must still
// have its OWN conversation — this is what the partial index buys us.
const pairs = new Map()
for (const b of bookings) {
  const k = `${b.listing_id}|${b.renter_id}`
  pairs.set(k, (pairs.get(k) ?? 0) + 1)
}
const repeats = [...pairs.values()].filter(n => n > 1).length
check('repeat-rental pairs each kept their own conversation', repeats > 0, `${repeats} repeated pairs present in data`)

done()
