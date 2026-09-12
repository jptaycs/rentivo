// One-off: empty and remove the payment-qr-codes bucket. The host-QR
// feature is gone, so these images (a host's personal payment QR) have no
// remaining purpose and are personal data we no longer have a basis to keep.
//
// Objects in this bucket are folder-scoped as <uid>/<uuid>.<ext> (see
// AGENTS.md's host-QR Status entry). A top-level list only returns the
// per-user folder placeholders, not the real objects inside them, so this
// script recurses one level to collect real object paths before deleting.
//
// Usage: node --experimental-strip-types scripts/cleanup-payment-qr-bucket.mjs
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }

async function listPrefix(prefix) {
  const res = await fetch(`${URL}/storage/v1/object/list/payment-qr-codes`, {
    method: 'POST', headers: H, body: JSON.stringify({ prefix, limit: 1000 }),
  })
  const body = await res.json()
  return Array.isArray(body) ? body : []
}

// Top-level list returns folder placeholders (id: null) for each <uid>.
const topLevel = await listPrefix('')
console.log('top-level entries found:', topLevel.length, JSON.stringify(topLevel.map(f => f.name)))

let realFiles = []
for (const entry of topLevel) {
  if (entry.id === null) {
    // It's a folder — recurse one level to find the real object(s) inside.
    const inner = await listPrefix(entry.name)
    for (const f of inner) realFiles.push({ ...f, name: `${entry.name}/${f.name}` })
  } else {
    realFiles.push(entry)
  }
}
console.log('real objects found:', realFiles.length, JSON.stringify(realFiles.map(f => f.name)))

if (realFiles.length > 0) {
  const names = realFiles.map(f => f.name)
  const del = await fetch(`${URL}/storage/v1/object/payment-qr-codes`, {
    method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: names }),
  })
  console.log('delete objects:', del.status, (await del.text()).slice(0, 200))
}

// Belt-and-suspenders: explicitly empty the bucket via Supabase's own
// emptyBucket endpoint too, in case any residual object wasn't reached above.
const empty = await fetch(`${URL}/storage/v1/bucket/payment-qr-codes/empty`, {
  method: 'POST', headers: H,
})
console.log('empty bucket:', empty.status, (await empty.text()).slice(0, 200))

const drop = await fetch(`${URL}/storage/v1/bucket/payment-qr-codes`, { method: 'DELETE', headers: H })
console.log('drop bucket:', drop.status, (await drop.text()).slice(0, 200))
