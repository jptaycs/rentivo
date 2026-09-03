// Verifies migration 059: profiles' private columns are no longer readable
// through raw PostgREST with the anon key or a signed-in session, every
// public read path still works, and the owner reads their own full row via
// get_my_profile(). Real sessions for every authorisation check; admin only
// for setup/cleanup. The demo host gets a temporary probe qr_payment_label so
// the leak is tested against a real non-null value, restored afterwards.
import { URL as SUPABASE_URL, ANON, admin, asUser, signIn } from './env.mjs'

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }
const rpc = async (tok, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const denied = (r) => r.status === 401 || r.status === 403 || (r.status >= 400 && /permission denied/.test(JSON.stringify(r.body)))

const PROFILE_COLUMNS = 'id, full_name, avatar_url, is_verified, is_host, host_rating, host_review_count, response_time_hours, bio, city, created_at, qr_payment_url'

const hostTok = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const hostId = JSON.parse(Buffer.from(hostTok.split('.')[1], 'base64url').toString()).sub
const renterId = JSON.parse(Buffer.from(renterTok.split('.')[1], 'base64url').toString()).sub

// Setup: give the demo host a probe label so a leak would return real text.
const { body: [orig] } = await admin(`profiles?select=qr_payment_label,bio&id=eq.${hostId}`)
await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ qr_payment_label: 'PROBE-LABEL 0917 000 0000' }) })

try {
  // ── Private columns: denied for anon and for a signed-in stranger ──
  for (const [who, tok] of [['anon', null], ['renter session', renterTok]]) {
    for (const col of ['qr_payment_label', 'notify_messages', 'updated_at']) {
      const r = await asUser(tok, `profiles?select=${col}&id=eq.${hostId}`)
      check(`${who}: select=${col} denied`, denied(r), `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`)
    }
    const star = await asUser(tok, `profiles?select=*&id=eq.${hostId}`)
    check(`${who}: select=* denied`, denied(star), `${star.status}`)
    const embedStar = await asUser(tok, `listings?select=id,host:profiles!listings_host_id_fkey(*)&limit=1`)
    check(`${who}: profiles(*) embed denied`, denied(embedStar), `${embedStar.status}`)
    // The label must not appear anywhere in a permitted response either.
    const pub = await asUser(tok, `profiles?select=${encodeURIComponent(PROFILE_COLUMNS)}&id=eq.${hostId}`)
    check(`${who}: PROFILE_COLUMNS still readable`, pub.status === 200 && pub.body.length === 1 && pub.body[0].full_name, `${pub.status}`)
    check(`${who}: probe label absent from the permitted response`, !JSON.stringify(pub.body).includes('PROBE-LABEL'))
  }

  // ── Even the OWNER cannot read the private columns through the table ──
  const ownStar = await asUser(hostTok, `profiles?select=qr_payment_label&id=eq.${hostId}`)
  check('owner: table read of own qr_payment_label denied (column grant, not RLS)', denied(ownStar), `${ownStar.status}`)

  // ── Storefront read paths (the !inner-join concern) ──
  const inner = await asUser(null, `listings?select=id,host:profiles!listings_host_id_fkey!inner(${encodeURIComponent(PROFILE_COLUMNS)})&is_active=eq.true&is_draft=eq.false&host.suspended_at=is.null&limit=50`)
  check('anon: !inner host embed returns listings', inner.status === 200 && inner.body.length > 0, `${inner.status} rows=${inner.body?.length}`)
  check('anon: embedded host carries qr_payment_url key (Step3Payment hasHostQr)', inner.status === 200 && 'qr_payment_url' in inner.body[0].host)
  const count = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=id,host:profiles!listings_host_id_fkey!inner(id)&is_active=eq.true&is_draft=eq.false&host.suspended_at=is.null`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact', Range: '0-0' },
  })
  check('anon: active listing count still resolves', count.status === 206 || count.status === 200, `${count.status} ${count.headers.get('content-range')}`)
  const hostProfile = await asUser(null, `profiles?select=${encodeURIComponent(PROFILE_COLUMNS)}&id=eq.${hostId}&is_host=eq.true`)
  check('anon: getHostProfile shape still returns the host', hostProfile.status === 200 && hostProfile.body.length === 1)
  const singleCols = await asUser(renterTok, `profiles?select=suspended_at&id=eq.${renterId}`)
  check('renter session: middleware suspended_at read still works', singleCols.status === 200 && singleCols.body.length === 1)
  const isVerified = await asUser(hostTok, `profiles?select=is_verified&id=eq.${hostId}`)
  check('host session: is_verified read (wizard/useVerification) still works', isVerified.status === 200 && isVerified.body.length === 1)
  const fullName = await asUser(renterTok, `profiles?select=full_name&id=eq.${renterId}`)
  check('renter session: full_name read (checkout route) still works', fullName.status === 200 && fullName.body.length === 1)

  // ── get_my_profile(): owner sees everything, only their own row ──
  const mine = await rpc(hostTok, 'get_my_profile')
  check('host: get_my_profile returns own row', mine.status === 200 && mine.body?.id === hostId, `${mine.status}`)
  check('host: own row includes the private label', mine.body?.qr_payment_label === 'PROBE-LABEL 0917 000 0000')
  check('host: own row includes notify prefs', typeof mine.body?.notify_messages === 'boolean')
  const renterMine = await rpc(renterTok, 'get_my_profile')
  check('renter: get_my_profile returns the RENTER, not the host', renterMine.status === 200 && renterMine.body?.id === renterId)
  const anonMine = await rpc(null, 'get_my_profile')
  check('anon: get_my_profile denied', denied(anonMine), `${anonMine.status}`)

  // ── Own-row writes still work with return=minimal (useProfile.update) ──
  const w = await asUser(hostTok, `profiles?id=eq.${hostId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ bio: 'probe bio 059' }) })
  check('host: own bio update still works', w.status === 204, `${w.status} ${JSON.stringify(w.body).slice(0, 80)}`)
  const after = await rpc(hostTok, 'get_my_profile')
  check('host: update visible through get_my_profile', after.body?.bio === 'probe bio 059')
  const wLabel = await asUser(hostTok, `profiles?id=eq.${hostId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ qr_payment_label: 'PROBE-LABEL 2' }) })
  check('host: own qr_payment_label update still works (040 grant intact)', wLabel.status === 204, `${wLabel.status}`)
  const wRep = await asUser(hostTok, `profiles?id=eq.${hostId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ bio: 'probe bio 059' }) })
  check('host: update with return=representation is denied (documented: no select on *)', denied(wRep), `${wRep.status}`)
  const wStranger = await asUser(renterTok, `profiles?id=eq.${hostId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ bio: 'hacked' }) })
  const { body: [chk] } = await admin(`profiles?select=bio&id=eq.${hostId}`)
  check('renter: cannot update host bio (RLS, unchanged)', chk.bio === 'probe bio 059', `${wStranger.status} bio=${chk.bio}`)
} finally {
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ qr_payment_label: orig.qr_payment_label, bio: orig.bio }) })
  const { body: [restored] } = await admin(`profiles?select=qr_payment_label,bio&id=eq.${hostId}`)
  check('cleanup: demo host label + bio restored', restored.qr_payment_label === orig.qr_payment_label && restored.bio === orig.bio)
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
