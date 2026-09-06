// DEMO DATA — seeds 5 reviews per seed listing so the storefront looks populated
// for a walkthrough. Reversible: `node --experimental-strip-types
// scripts/seed-demo-reviews.mjs remove` deletes exactly what it created.
//
// Boundaries, deliberately:
//   * SEED listings only. The real host's listing (c38111b3, Isse Capucao) is
//     excluded — inventing testimony about a real person's service is not the
//     same as populating placeholder inventory.
//   * `reviews.booking_id` is NOT NULL, so each review needs a booking. Those
//     bookings are created `completed` + **unpaid** on purpose: /admin/reports
//     and the commission figures filter on `payment_status = 'paid'`, and payout
//     eligibility requires paid, so this seed does NOT inflate revenue,
//     commission, earnings or unrequested-payout totals. It only fills reviews.
//   * Every row it writes is tagged (booking_ref prefix DEMO-) so `remove` can
//     find them again without guessing.
import { admin } from './verify/env.mjs'

const REAL_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const TAG = 'DEMO-'
const mode = process.argv[2] ?? 'add'

const COMMENTS = [
  ['Gear arrived exactly as described and the handover was quick. Would rent again.', 5],
  ['Very well looked after — everything clean, batteries charged, no surprises.', 5],
  ['Smooth pickup and the host answered questions fast. Solid experience.', 5],
  ['Worked perfectly for a weekend shoot. Fair price for the condition.', 4],
  ['Easy to arrange and the kit performed well. Happy to book again.', 5],
]

if (mode === 'remove') {
  const { body: bookings } = await admin(`bookings?select=id&booking_ref=like.${TAG}*`)
  const ids = (bookings ?? []).map((b) => b.id)
  if (!ids.length) { console.log('no demo bookings found — nothing to remove'); process.exit(0) }
  await admin(`reviews?booking_id=in.(${ids.join(',')})`, { method: 'DELETE' })
  for (const id of ids) {
    await admin(`availability_blocks?booking_id=eq.${id}`, { method: 'DELETE' })
    const { body: convs } = await admin(`conversations?select=id&booking_id=eq.${id}`)
    for (const c of convs ?? []) await admin(`messages?conversation_id=eq.${c.id}`, { method: 'DELETE' })
    await admin(`conversations?booking_id=eq.${id}`, { method: 'DELETE' })
  }
  await admin(`bookings?booking_ref=like.${TAG}*`, { method: 'DELETE' })
  const { body: revLeft } = await admin('reviews?select=id')
  const { body: bkLeft } = await admin('bookings?select=id')
  console.log(`removed. reviews now ${revLeft.length}, bookings now ${bkLeft.length}`)
  process.exit(0)
}

// Listings to populate: active, public, seed-owned, never the real host's.
const { body: listings } = await admin(
  'listings?select=id,title,host_id,daily_price&is_active=eq.true&is_draft=eq.false'
)
const targets = listings.filter((l) => l.host_id !== REAL_HOST)
console.log(`listings to populate: ${targets.length} (excluded real host's: ${listings.length - targets.length})`)

// Reviewers: seed profiles, never the listing's own host.
const { body: profiles } = await admin('profiles?select=id,full_name')
const pool = profiles.filter((p) => p.id !== REAL_HOST)

let reviews = 0, bookings = 0
for (const [li, listing] of targets.entries()) {
  const reviewers = pool.filter((p) => p.id !== listing.host_id)
  for (let i = 0; i < 5; i++) {
    const reviewer = reviewers[(li * 5 + i) % reviewers.length]
    const [comment, rating] = COMMENTS[i % COMMENTS.length]
    const ref = `${TAG}${String(li).padStart(2, '0')}${i}${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const start = new Date(Date.now() - (30 + li * 7 + i * 3) * 86400000)
    const end = new Date(start.getTime() + 2 * 86400000)
    const res = await admin('bookings', {
      method: 'POST',
      body: JSON.stringify({
        booking_ref: ref,
        listing_id: listing.id,
        renter_id: reviewer.id,
        host_id: listing.host_id,
        pickup_date: start.toISOString().slice(0, 10),
        return_date: end.toISOString().slice(0, 10),
        rental_fee: listing.daily_price * 2,
        service_fee: 0,
        protection_fee: 0,
        security_deposit: 0,
        delivery_fee: 0,
        total_amount: listing.daily_price * 2,
        status: 'completed',
        payment_status: 'unpaid',   // keeps money reports honest — see header
        payment_method: null,
        is_delivery: false,
      }),
    })
    const booking = Array.isArray(res.body) ? res.body[0] : null
    if (res.status >= 400 || !booking) {
      console.error('booking insert failed:', res.status, JSON.stringify(res.body).slice(0, 300))
      process.exit(1)
    }
    bookings++
    const r = await admin('reviews', {
      method: 'POST',
      body: JSON.stringify({
        booking_id: booking.id,
        reviewer_id: reviewer.id,
        reviewee_id: listing.host_id,
        listing_id: listing.id,
        rating,
        comment,
        created_at: end.toISOString(),
      }),
    })
    if (r.status >= 400) { console.error('review failed', r.status, JSON.stringify(r.body).slice(0, 160)); process.exit(1) }
    reviews++
  }
}
console.log(`created ${bookings} demo bookings and ${reviews} reviews`)
