// scripts/backfill-listing-coordinates.mjs
// One-time. Materialises the city-centre pin each listing ALREADY shows into
// latitude/longitude. Nothing is invented: this is the same getCityCoordinates()
// value PickupMap renders today. location_is_exact stays false, so no UI
// presents these as a precise pickup point.
import { admin } from './verify/env.mjs'
const { getCityCoordinates } = await import('../src/lib/ph-locations.ts')

const { body: rows } = await admin('listings?select=id,city,province,latitude,longitude')
let written = 0
for (const l of rows) {
  if (l.latitude !== null && l.longitude !== null) continue
  const { lat, lng } = getCityCoordinates(l.city ?? '', l.province ?? '')
  const res = await admin(`listings?id=eq.${l.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ latitude: lat, longitude: lng, location_is_exact: false }),
  })
  if (res.status >= 400) throw new Error(`${l.id}: ${JSON.stringify(res.body)}`)
  written++
}
const { body: left } = await admin('listings?select=id&or=(latitude.is.null,longitude.is.null)')
console.log(`backfilled ${written}; rows still null: ${left.length}`)
if (left.length > 0) { console.error('ABORT: do not apply 066 while rows are null'); process.exit(1) }
