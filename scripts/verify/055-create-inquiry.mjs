// Rentivo — Task 5 verification: create_inquiry RPC + booking-attach trigger.
//
// Uses asUser (real anon-key + user JWT) for every authorisation assertion —
// admin() is service-role and bypasses RLS/grants, so it can only be used for
// setup, independent re-reads, and cleanup, never to prove a refusal.
import { URL, ANON, SECRET, admin, signIn, check, done } from './env.mjs'

async function deleteAuthUser(id) {
  await fetch(`${URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}

async function rpc(token, fn, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.text() }
}

// GoTrue admin create (service role) — pre-confirmed, so signIn() works
// immediately with no email step. Mirrors 053-messages-rls.mjs's pattern.
async function createProbeUser(email, password) {
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const json = await res.json()
  if (!json?.id) throw new Error(`could not create throwaway probe account ${email}: ${JSON.stringify(json)}`)
  return json.id
}

const stamp = Date.now()
const cleanup = { conversationIds: [], profileIds: [], listingIds: [], bookingIds: [] }

function jwtSub(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  return payload.sub
}

const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const hostTok   = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')

const hostProfile = { id: jwtSub(hostTok) }

const live = (await admin('listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&host_id=neq.' + hostProfile.id + '&limit=1')).body[0]
if (!live) throw new Error('no live listing available to test against')

try {
  // 1. Happy path: renter opens an inquiry on a live listing.
  const ok = await rpc(renterTok, 'create_inquiry', { p_listing_id: live.id, p_content: 'Is this available?' })
  check('renter can open an inquiry', ok.status === 200 && ok.body.includes('-'), `status ${ok.status} ${ok.body.slice(0, 120)}`)
  const convoId = JSON.parse(ok.body)
  cleanup.conversationIds.push(convoId)

  const convoRow = (await admin(`conversations?select=id,booking_id,listing_id,renter_id,host_id&id=eq.${convoId}`)).body[0]
  check('conversation row exists with booking_id null', !!convoRow && convoRow.booking_id === null,
    JSON.stringify(convoRow))

  const msgRows = (await admin(`messages?select=id,content,conversation_id,booking_id&conversation_id=eq.${convoId}`)).body
  check('a message exists on the conversation', msgRows.length === 1 && msgRows[0].content === 'Is this available?',
    JSON.stringify(msgRows))

  // 2. Idempotent: second call for the same listing reuses the same conversation.
  const again = await rpc(renterTok, 'create_inquiry', { p_listing_id: live.id, p_content: 'Following up' })
  check('second inquiry on the same listing reuses the conversation',
    again.status === 200 && JSON.parse(again.body) === convoId, `${again.status} ${again.body.slice(0, 120)}`)

  // 3. Refused: caller's own listing.
  const selfHost = (await admin(`listings?select=id&host_id=eq.${hostProfile.id}&is_active=eq.true&is_draft=eq.false&limit=1`)).body[0]
  if (selfHost) {
    const self = await rpc(hostTok, 'create_inquiry', { p_listing_id: selfHost.id, p_content: 'hi' })
    check('cannot inquire on your own listing', self.status >= 400, `status ${self.status} ${self.body.slice(0, 120)}`)
  } else {
    console.log('SKIP  demo host has no active/published listing to test the own-listing refusal against')
  }

  // 4. Refused: a draft listing. No draft listing currently exists in the
  // database, so use a throwaway probe listing rather than skip this check.
  let draft = (await admin('listings?select=id&is_draft=eq.true&limit=1')).body[0]
  if (!draft) {
    draft = (await admin('listings', {
      method: 'POST',
      body: JSON.stringify({
        host_id: hostProfile.id,
        title: `Probe Draft Listing ${stamp}`,
        brand: 'Probe', model: 'D', category: 'mirrorless',
        description: 'probe', condition: 'good',
        daily_price: 100, security_deposit: 0,
        city: 'Manila', province: 'Metro Manila',
        is_active: true, is_draft: true,
        images: ['https://example.com/x.jpg'],
      }),
    })).body[0]
    cleanup.listingIds.push(draft.id)
  }
  const d = await rpc(renterTok, 'create_inquiry', { p_listing_id: draft.id, p_content: 'hi' })
  check('cannot inquire on a draft listing', d.status >= 400, `status ${d.status} ${d.body.slice(0, 120)}`)

  // 5. Refused: an inactive listing. Flip a throwaway probe listing rather
  // than touching a real one — clone the live listing's row shape minimally.
  const inactiveProbe = (await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostProfile.id,
      title: `Probe Inactive Listing ${stamp}`,
      brand: 'Probe', model: 'X', category: 'mirrorless',
      description: 'probe', condition: 'good',
      daily_price: 100, security_deposit: 0,
      city: 'Manila', province: 'Metro Manila',
      is_active: false, is_draft: false,
      images: ['https://example.com/x.jpg'],
    }),
  })).body[0]
  cleanup.listingIds.push(inactiveProbe.id)
  const inactive = await rpc(renterTok, 'create_inquiry', { p_listing_id: inactiveProbe.id, p_content: 'hi' })
  check('cannot inquire on an inactive listing', inactive.status >= 400, `status ${inactive.status} ${inactive.body.slice(0, 120)}`)

  // 6. Refused: a listing whose host is suspended. Throwaway probe host + listing only.
  const probeHostEmail = `probe-suspended-host-${stamp}@example.com`
  const probeHostId = await createProbeUser(probeHostEmail, 'ProbePassword1!')
  cleanup.profileIds.push(probeHostId)
  await admin(`profiles?id=eq.${probeHostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_host: true, full_name: 'Probe Suspended Host' }),
  })
  const suspendedListing = (await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: probeHostId,
      title: `Probe Suspended-Host Listing ${stamp}`,
      brand: 'Probe', model: 'Y', category: 'mirrorless',
      description: 'probe', condition: 'good',
      daily_price: 100, security_deposit: 0,
      city: 'Manila', province: 'Metro Manila',
      is_active: true, is_draft: false,
      images: ['https://example.com/x.jpg'],
    }),
  })).body[0]
  cleanup.listingIds.push(suspendedListing.id)
  await admin(`profiles?id=eq.${probeHostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ suspended_at: new Date().toISOString() }),
  })
  const suspended = await rpc(renterTok, 'create_inquiry', { p_listing_id: suspendedListing.id, p_content: 'hi' })
  check('cannot inquire on a listing whose host is suspended', suspended.status >= 400, `status ${suspended.status} ${suspended.body.slice(0, 120)}`)
  // Clear suspension immediately so nothing lingers even if a later check throws.
  await admin(`profiles?id=eq.${probeHostId}`, { method: 'PATCH', body: JSON.stringify({ suspended_at: null }) })

  // 7. Refused: the 24h cap (10). Use a throwaway renter + 10 throwaway
  // listings so the partial unique index (one open inquiry per listing+renter)
  // never gets in the way of creating 10 distinct conversations.
  const probeRenterEmail = `probe-cap-renter-${stamp}@example.com`
  const probeRenterId = await createProbeUser(probeRenterEmail, 'ProbePassword1!')
  cleanup.profileIds.push(probeRenterId)
  const probeRenterTok = await signIn(probeRenterEmail, 'ProbePassword1!')

  const capListingIds = []
  for (let i = 0; i < 11; i++) {
    const l = (await admin('listings', {
      method: 'POST',
      body: JSON.stringify({
        host_id: hostProfile.id,
        title: `Probe Cap Listing ${stamp} #${i}`,
        brand: 'Probe', model: 'Z', category: 'mirrorless',
        description: 'probe', condition: 'good',
        daily_price: 100, security_deposit: 0,
        city: 'Manila', province: 'Metro Manila',
        is_active: true, is_draft: false,
        images: ['https://example.com/x.jpg'],
      }),
    })).body[0]
    capListingIds.push(l.id)
    cleanup.listingIds.push(l.id)
  }

  let capConvoIds = []
  for (let i = 0; i < 10; i++) {
    const r = await rpc(probeRenterTok, 'create_inquiry', { p_listing_id: capListingIds[i], p_content: `probe ${i}` })
    if (r.status === 200) capConvoIds.push(JSON.parse(r.body))
  }
  cleanup.conversationIds.push(...capConvoIds)
  check('10 conversations for one renter within 24h all succeed', capConvoIds.length === 10, `created ${capConvoIds.length}`)

  const eleventh = await rpc(probeRenterTok, 'create_inquiry', { p_listing_id: capListingIds[10], p_content: 'probe 11' })
  check('the 11th conversation in 24h is refused (cap of 10)', eleventh.status >= 400, `status ${eleventh.status} ${eleventh.body.slice(0, 120)}`)

  // 8. Attach-on-booking: open an inquiry, then book the same listing+renter
  // via create_booking, and confirm the SAME conversation now has booking_id
  // set and its original message is still present.
  const bookableListing = (await admin(`listings?select=id,host_id,daily_price,security_deposit&id=eq.${live.id}`)).body[0]
  const attachInquiry = await rpc(renterTok, 'create_inquiry', { p_listing_id: bookableListing.id, p_content: 'attach-test inquiry' })
  const attachConvoId = JSON.parse(attachInquiry.body)
  check('attach-test inquiry reused the existing open conversation', attachConvoId === convoId, `${attachConvoId} vs ${convoId}`)

  const pickup = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const ret = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10)
  const bookRes = await rpc(renterTok, 'create_booking', {
    p_listing_id: bookableListing.id,
    p_pickup_date: pickup,
    p_return_date: ret,
    p_is_delivery: false,
    p_delivery_address: null,
    p_payment_method: 'test_skip',
    p_renter_notes: null,
    p_promo_code: null,
  })
  check('create_booking succeeds for the attach test', bookRes.status === 200 || bookRes.status === 201, `status ${bookRes.status} ${bookRes.body.slice(0, 200)}`)
  const bookedRow = JSON.parse(bookRes.body)
  cleanup.bookingIds.push(bookedRow.id)

  const afterBooking = (await admin(`conversations?select=id,booking_id&id=eq.${attachConvoId}`)).body[0]
  check('the same conversation now has booking_id set to the new booking', afterBooking && afterBooking.booking_id === bookedRow.id,
    JSON.stringify(afterBooking))

  const originalMsgStillThere = (await admin(`messages?select=id&conversation_id=eq.${attachConvoId}&content=eq.Is this available?`)).body
  check('the original inquiry message is still present after attach', originalMsgStillThere.length === 1, JSON.stringify(originalMsgStillThere))

  // 9. A second booking of the same listing by the same renter creates a
  // SECOND conversation (repeat-rental case) and does not violate the
  // partial unique index.
  const pickup2 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
  const ret2 = new Date(Date.now() + 63 * 86400000).toISOString().slice(0, 10)
  const bookRes2 = await rpc(renterTok, 'create_booking', {
    p_listing_id: bookableListing.id,
    p_pickup_date: pickup2,
    p_return_date: ret2,
    p_is_delivery: false,
    p_delivery_address: null,
    p_payment_method: 'test_skip',
    p_renter_notes: null,
    p_promo_code: null,
  })
  check('a second booking of the same listing+renter succeeds', bookRes2.status === 200 || bookRes2.status === 201, `status ${bookRes2.status} ${bookRes2.body.slice(0, 200)}`)
  const bookedRow2 = JSON.parse(bookRes2.body)
  cleanup.bookingIds.push(bookedRow2.id)

  const convosForBooking2 = (await admin(`conversations?select=id,booking_id&booking_id=eq.${bookedRow2.id}`)).body
  check('the second booking got its own, distinct conversation', convosForBooking2.length === 1 && convosForBooking2[0].id !== attachConvoId,
    JSON.stringify(convosForBooking2))
  if (convosForBooking2[0]) cleanup.conversationIds.push(convosForBooking2[0].id)

} finally {
  // ── Cleanup ────────────────────────────────────────────────────────────
  // Bookings first (cascades their attached conversation via ON DELETE CASCADE,
  // and cascades their messages), then any still-open conversations + messages,
  // then probe listings, then probe profiles/auth users.
  for (const id of cleanup.bookingIds) {
    await admin(`availability_blocks?booking_id=eq.${id}`, { method: 'DELETE' })
    await admin(`bookings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of [...new Set(cleanup.conversationIds)]) {
    await admin(`messages?conversation_id=eq.${id}`, { method: 'DELETE' })
    await admin(`conversations?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of cleanup.listingIds) {
    await admin(`listings?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of cleanup.profileIds) {
    await admin(`profiles?id=eq.${id}`, { method: 'DELETE' })
    await deleteAuthUser(id)
  }
}

done()
