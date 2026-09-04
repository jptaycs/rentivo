// scripts/verify/065-listing-coordinates.mjs
//
// Deviation from the task brief's script, deliberate: the brief's cleanup set
// latitude/longitude back to null. A later migration in this plan makes those
// columns NOT NULL, which would make that cleanup illegal and this script
// unrunnable. Instead we snapshot the chosen row's original latitude/
// longitude first and restore exactly those values afterward.
import { URL as SUPABASE_URL, ANON, admin } from './env.mjs'
let fails = 0
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); if (!ok) fails++ }
const anonGet = async (sel) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=${encodeURIComponent(sel)}&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
  return { status: r.status, body: await r.text() }
}

const pub = await anonGet('id,approx_latitude,approx_longitude,location_is_exact')
check('anon can read approx_* and location_is_exact', pub.status === 200, `${pub.status}`)

const exact = await anonGet('latitude,longitude')
check('anon still cannot read exact coordinates', exact.status === 401 || exact.status === 403, `${exact.status}`)

// Generated columns track the source value exactly.
const { body: [row] } = await admin('listings?select=id&limit=1')

// Snapshot the row's original coordinates so cleanup can restore them exactly
// — the brief's own cleanup (set both to null) would violate a later
// migration's NOT NULL constraint on these columns.
const { body: [original] } = await admin(`listings?select=latitude,longitude&id=eq.${row.id}`)

await admin(`listings?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ latitude: 14.5678901, longitude: 120.9876543 }) })
const { body: [after] } = await admin(`listings?select=latitude,longitude,approx_latitude,approx_longitude&id=eq.${row.id}`)
check('approx_latitude = round(latitude, 2)', Number(after.approx_latitude) === 14.57, `${after.approx_latitude}`)
check('approx_longitude = round(longitude, 2)', Number(after.approx_longitude) === 120.99, `${after.approx_longitude}`)
check('approx differs from exact', Number(after.approx_latitude) !== Number(after.latitude))

await admin(`listings?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ latitude: original.latitude, longitude: original.longitude }) })

const { body: [restored] } = await admin(`listings?select=latitude,longitude,approx_latitude&id=eq.${row.id}`)
check(
  'cleanup restored the row to its original values',
  restored.latitude === original.latitude && restored.longitude === original.longitude
)
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
