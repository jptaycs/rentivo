import 'server-only'
import { Resend } from 'resend'
import { createAdminClient } from './supabase/admin'
import {
  plainSubject,
  fmtPeso,
  hostNewBookingHtml,
  renterConfirmedHtml,
  renterPendingHtml,
  renterDeclinedHtml,
  hostCancelledByRenterHtml,
  newMessageHtml,
  adminDecisionHtml,
  notesBlock,
  payoutStatementIssuedHtml,
  payoutStatementReversedHtml,
  type PayoutStatementEmailContext,
} from './email-templates'

// Every HTML template lives in ./email-templates.ts, which escapes each user- or
// host-authored value at the point of interpolation (security audit 2,
// MEDIUM-1). Do not build HTML from database values in this file.

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY)
}

const FROM = process.env.EMAIL_FROM || 'Rentivo <onboarding@resend.dev>'

/**
 * Returns TRUE only when a send was actually attempted and Resend returned no
 * error; FALSE when the key is absent or the send failed or threw. Most callers
 * ignore the value — they are fire-and-forget notifications. The payout
 * statement senders do not: that boolean is what decides whether
 * `payout_requests.statement_emailed_at` is stamped, and the stamp is the
 * difference between "the host knows" and "we assume they know".
 */
async function send(to: string, subject: string, html: string): Promise<boolean> {
  // Subjects are built from user-set values (a sender's full_name); strip
  // control characters so nothing can carry a newline into the header.
  const safeSubject = plainSubject(subject)
  if (!isEmailConfigured()) {
    console.log(`[email] RESEND_API_KEY not set — skipped "${safeSubject}" to ${to}`)
    return false
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({ from: FROM, to, subject: safeSubject, html })
    if (error) {
      console.error('[email] send failed', error)
      return false
    }
    return true
  } catch (err) {
    console.error('[email] send threw', err)
    return false
  }
}

interface BookingRow {
  id: string
  booking_ref: string
  renter_id: string
  host_id: string
  pickup_date: string
  return_date: string
  total_amount: number
  payment_method: string | null
  status: string
  is_delivery: boolean
  delivery_address: string | null
  delivery_distance_km: number | null
  delivery_fee: number
  listing: { title: string; is_instant_book: boolean } | null
}

async function loadBookingContext(bookingId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('bookings')
    .select(
      'id, booking_ref, renter_id, host_id, pickup_date, return_date, total_amount, payment_method, status, is_delivery, delivery_address, delivery_distance_km, delivery_fee, listing:listings(title, is_instant_book)'
    )
    .eq('id', bookingId)
    .maybeSingle()
  const booking = data as unknown as BookingRow | null
  if (!booking) return null

  const [{ data: renterProfile }, { data: hostProfile }, renterUser, hostUser] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', booking.renter_id).single(),
    admin.from('profiles').select('full_name, notify_new_booking').eq('id', booking.host_id).single(),
    admin.auth.admin.getUserById(booking.renter_id),
    admin.auth.admin.getUserById(booking.host_id),
  ])

  const renterEmail = renterUser.data.user?.email
  const hostEmail = hostUser.data.user?.email
  if (!renterEmail || !hostEmail) return null

  return {
    booking,
    renterEmail,
    hostEmail,
    renterName: renterProfile?.full_name || 'there',
    hostName: hostProfile?.full_name || 'the host',
    hostNotifyNewBooking: hostProfile?.notify_new_booking ?? true,
  }
}

/** Call after a booking's payment_status flips to 'paid'. */
export async function notifyBookingPaid(bookingId: string) {
  const ctx = await loadBookingContext(bookingId)
  if (!ctx) return
  const { booking, renterEmail, hostEmail, renterName, hostName, hostNotifyNewBooking } = ctx
  // Decide the copy from the booking's STORED status, not the listing's
  // Instant Book flag. They normally agree — mark_booking_paid flips an
  // Instant Book booking to confirmed — but since 077 the double-booking guard
  // may record the payment and leave it pending when its dates were taken by
  // another confirmed rental in the meantime. Keying off is_instant_book told
  // that renter "Booking Confirmed" for a rental the database had refused.
  // Every caller runs this after mark_booking_paid, so status is final here.
  const instant = booking.status === 'confirmed'
  const listingTitle = booking.listing?.title ?? 'a listing'

  const base = {
    bookingRef: booking.booking_ref,
    listingTitle,
    pickupDate: booking.pickup_date,
    returnDate: booking.return_date,
    totalAmount: booking.total_amount,
  }

  if (!hostNotifyNewBooking) {
    console.log(`[email] skipped host new-booking email — notify_new_booking off for booking ${booking.id}`)
  }

  await Promise.all([
    hostNotifyNewBooking
      ? send(
          hostEmail,
          instant ? `New Instant Booking — ${booking.booking_ref}` : `New Booking Request — ${booking.booking_ref}`,
          hostNewBookingHtml(
            { ...base, otherPartyName: renterName },
            instant,
            // The host must see where they are delivering, and the distance the
            // fee was priced on, to catch a pin that doesn't match the address
            // (distance-based delivery final review, I1). No coordinates here.
            booking.is_delivery
              ? {
                  address: booking.delivery_address,
                  distanceKm: booking.delivery_distance_km,
                  fee: booking.delivery_fee,
                }
              : null
          )
        )
      : Promise.resolve(),
    send(
      renterEmail,
      instant ? `Booking Confirmed — ${booking.booking_ref}` : `Payment Received — ${booking.booking_ref}`,
      instant
        ? renterConfirmedHtml({ ...base, otherPartyName: hostName })
        : renterPendingHtml({ ...base, otherPartyName: hostName })
    ),
  ])
}

/**
 * Call after a booking's status changes via host confirm/decline or renter
 * cancel. `cancelledBy` only matters when status is 'cancelled' — it
 * decides who gets notified (the *other* party) and which template fires.
 */
export async function notifyBookingResponded(
  bookingId: string,
  status: 'confirmed' | 'cancelled',
  cancelledBy?: 'host' | 'renter',
  refunded = false
) {
  const ctx = await loadBookingContext(bookingId)
  if (!ctx) return
  const { booking, renterEmail, hostEmail, renterName, hostName } = ctx
  const isHostQr = booking.payment_method === 'host_qr'

  const forRenter = {
    bookingRef: booking.booking_ref,
    listingTitle: booking.listing?.title ?? 'a listing',
    pickupDate: booking.pickup_date,
    returnDate: booking.return_date,
    totalAmount: booking.total_amount,
    otherPartyName: hostName,
  }

  if (status === 'confirmed') {
    await send(renterEmail, `Booking Confirmed — ${booking.booking_ref}`, renterConfirmedHtml(forRenter))
    return
  }

  if (cancelledBy === 'renter') {
    const forHost = { ...forRenter, otherPartyName: renterName }
    await send(hostEmail, `Booking Cancelled — ${booking.booking_ref}`, hostCancelledByRenterHtml(forHost, refunded, isHostQr))
  } else {
    await send(renterEmail, `Booking Declined — ${booking.booking_ref}`, renterDeclinedHtml(forRenter, refunded, isHostQr))
  }
}

/** Call after a message is inserted, to email whichever party didn't send it. */
export async function notifyNewMessage(messageId: string) {
  const admin = createAdminClient()
  const { data: message } = await admin
    .from('messages')
    .select('conversation_id, sender_id, content, image_url')
    .eq('id', messageId)
    .maybeSingle()
  if (!message) return

  const { data: conversation } = await admin
    .from('conversations')
    .select('renter_id, host_id, listing:listings(title)')
    .eq('id', message.conversation_id)
    .maybeSingle()
  const convoRow = conversation as unknown as {
    renter_id: string
    host_id: string
    listing: { title: string } | null
  } | null
  if (!convoRow) return

  const recipientId = message.sender_id === convoRow.renter_id ? convoRow.host_id : convoRow.renter_id

  const [{ data: senderProfile }, { data: recipientProfile }, recipientUser] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', message.sender_id).single(),
    admin.from('profiles').select('notify_messages').eq('id', recipientId).single(),
    admin.auth.admin.getUserById(recipientId),
  ])
  if (recipientProfile?.notify_messages === false) {
    console.log(`[email] skipped new-message email — notify_messages off for recipient ${recipientId}`)
    return
  }
  const recipientEmail = recipientUser.data.user?.email
  if (!recipientEmail) return

  const preview = message.content ? message.content.slice(0, 140) : '📷 Sent a photo'

  await send(
    recipientEmail,
    `New message from ${senderProfile?.full_name || 'a Rentivo user'}`,
    newMessageHtml({
      senderName: senderProfile?.full_name || 'A Rentivo user',
      listingTitle: convoRow.listing?.title ?? 'a listing',
      preview,
      conversationId: message.conversation_id,
    })
  )
}

// ── Admin-decision outcome emails ─────────────────────────────
// Unconditional (no notification-preference gate) — these are
// decision receipts, same rationale as the renter payment email.

async function emailForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email ?? null
}

export async function notifyVerificationReviewed(
  userId: string,
  approved: boolean,
  notes: string | null
) {
  const to = await emailForUser(userId)
  if (!to) return
  await send(
    to,
    approved ? 'Your identity is verified ✅' : 'Your identity verification needs another look',
    adminDecisionHtml({
      heading: approved ? 'Identity Verified ✅' : 'Verification Not Approved',
      bodyHtml: approved
        ? `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your identity documents were approved — your account now shows the Verified badge.</p>`
        : `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">We couldn't approve your identity documents this time. You can resubmit from Settings.</p>${notesBlock(notes)}`,
      ctaPath: '/dashboard/settings',
      ctaLabel: approved ? 'View Your Profile Settings' : 'Resubmit Documents',
    })
  )
}

export async function notifyPayoutAccountReviewed(
  hostId: string,
  approved: boolean,
  notes: string | null
) {
  const to = await emailForUser(hostId)
  if (!to) return
  await send(
    to,
    approved ? 'Your payout account is verified' : 'Your payout account was not approved',
    adminDecisionHtml({
      heading: approved ? 'Payout Account Verified ✅' : 'Payout Account Not Approved',
      bodyHtml: approved
        ? `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your payout account was verified. Rentivo will send your payouts to this account.</p>`
        : `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">We couldn't verify your payout account. Please update it and it will be re-reviewed.</p>${notesBlock(notes)}`,
      ctaPath: '/dashboard/payouts',
      ctaLabel: 'Go to Payouts',
    })
  )
}

export async function notifyAccountSuspended(userId: string, reason: string | null) {
  const to = await emailForUser(userId)
  if (!to) return
  await send(
    to,
    'Your Rentivo account has been suspended',
    adminDecisionHtml({
      heading: 'Account Suspended',
      bodyHtml:
        `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your Rentivo account has been suspended. You can't sign in, and any listings you have are no longer visible on the marketplace.</p>` +
        notesBlock(reason) +
        `<p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">If you think this is a mistake, reply to this email and we'll take another look.</p>`,
      ctaPath: '/',
      ctaLabel: 'Go to Rentivo',
    })
  )
}

export async function notifyAccountReinstated(userId: string) {
  const to = await emailForUser(userId)
  if (!to) return
  await send(
    to,
    'Your Rentivo account has been reinstated',
    adminDecisionHtml({
      heading: 'Account Reinstated',
      // Deliberately does NOT promise the listings are back. Reinstatement
      // clears profiles.suspended_at, which un-hides listings the SUSPENSION
      // hid — but migration 037's verification gate hides a host's listings
      // independently (is_draft), and account deletion deactivates them. A
      // host whose ID was never approved would read "back on the marketplace",
      // go looking, and find nothing. Point them at the page that tells them
      // the truth instead of asserting it here.
      bodyHtml: `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your Rentivo account is active again — you can sign in as usual. If you host, check <strong>My Listings</strong> to confirm each one is live; anything still pending ID verification stays hidden until that's approved.</p>`,
      ctaPath: '/login',
      ctaLabel: 'Sign In',
    })
  )
}

// ── Payout statements (082) ────────────────────────────────────────────────
// Both senders resolve TRUE only when a send was actually attempted and Resend
// returned no error. That boolean decides whether
// `payout_requests.statement_emailed_at` is stamped (payout-statement-email.ts),
// so every early exit returns FALSE — the admin page then honestly shows the
// email as not sent. Neither is gated on a notification preference: a payout
// statement is a financial record, like the renter's payment receipt.

type StatementKind = 'issued' | 'reversed'

/** Last four only. PayoutStatement.tsx has the same rule, but it is a client
 *  module and cannot be called from here. The full number never leaves this
 *  function. */
function maskedAccountLabel(method: string | null, number: string | null) {
  const masked = number ? `•••• ${number.slice(-4)}` : '—'
  return `${method ?? 'Payout account'} ${masked}`
}

async function buildStatementContext(
  requestId: string,
  kind: StatementKind
): Promise<{ to: string; ctx: PayoutStatementEmailContext } | null> {
  const admin = createAdminClient()
  const { data: request, error } = await admin
    .from('payout_requests')
    .select('*, payout_items(*)')
    .eq('id', requestId)
    .maybeSingle()
  if (error) {
    console.error('[email] payout statement read failed:', error.message)
    return null
  }
  if (!request || !request.statement_number || !request.transferred_on || !request.reference) return null
  if (kind === 'reversed' && !request.reversed_at) return null
  if (kind === 'issued' && request.reversed_at) return null

  const to = await emailForUser(request.host_id)
  if (!to) return null
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', request.host_id)
    .maybeSingle()

  type ItemRow = {
    booking_ref: string | null
    listing_title: string | null
    pickup_date: string
    return_date: string
    rental_fee: number | null
    delivery_fee: number | null
    service_fee: number | null
  }
  const items = ((request.payout_items ?? []) as ItemRow[]).map((i) => {
    const rentalFee = i.rental_fee ?? 0
    const deliveryFee = i.delivery_fee ?? 0
    return {
      bookingRef: i.booking_ref ?? '—',
      listingTitle: i.listing_title ?? '—',
      pickupDate: i.pickup_date,
      returnDate: i.return_date,
      rentalFee,
      deliveryFee,
      serviceFee: i.service_fee ?? 0,
      earnings: rentalFee + deliveryFee,
    }
  })
  items.sort((a, b) => a.pickupDate.localeCompare(b.pickupDate))

  // Same totals as PayoutStatement.tsx: gross is what renters paid, the fee is
  // what Rentivo kept, and gross − fee is what was transferred.
  const totalRental = items.reduce((s, i) => s + i.rentalFee, 0)
  const deliveryFeeTotal = items.reduce((s, i) => s + i.deliveryFee, 0)
  const serviceFeeTotal = items.reduce((s, i) => s + i.serviceFee, 0)

  return {
    to,
    ctx: {
      hostName: profile?.full_name || 'there',
      statementNumber: request.statement_number,
      amount: request.amount,
      transferredOn: request.transferred_on,
      reference: request.reference,
      accountLabel: maskedAccountLabel(request.account_method, request.account_number),
      grossBookingValue: totalRental + deliveryFeeTotal + serviceFeeTotal,
      serviceFeeTotal,
      deliveryFeeTotal,
      requestId: request.id,
      items,
      reversedOn: request.reversed_at ?? undefined,
      reversalReason: request.reversal_reason ?? undefined,
    },
  }
}

export async function notifyPayoutStatementIssued(requestId: string): Promise<boolean> {
  const built = await buildStatementContext(requestId, 'issued')
  if (!built) return false
  const { to, ctx } = built
  return send(
    to,
    `Payout statement ${ctx.statementNumber} — ${fmtPeso(ctx.amount)} sent`,
    payoutStatementIssuedHtml(ctx)
  )
}

export async function notifyPayoutStatementReversed(requestId: string): Promise<boolean> {
  const built = await buildStatementContext(requestId, 'reversed')
  if (!built) return false
  const { to, ctx } = built
  return send(to, `Payout statement ${ctx.statementNumber} was reversed`, payoutStatementReversedHtml(ctx))
}
