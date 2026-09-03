import 'server-only'
import { Resend } from 'resend'
import { createAdminClient } from './supabase/admin'

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY)
}

const FROM = process.env.EMAIL_FROM || 'Rentivo <onboarding@resend.dev>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const fmtPeso = (n: number) => `₱${n.toLocaleString('en-PH')}`
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

function layout(preheader: string, bodyHtml: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:480px;width:100%;">
          <tr><td style="background:#003049;padding:24px 32px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;">Rentivo</span>
          </td></tr>
          <tr><td style="padding:32px;">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 32px;background:#F8FAFC;border-top:1px solid #eef1f5;">
            <p style="margin:0;color:#9aa3af;font-size:12px;line-height:1.5;">
              Rentivo — Rent Smarter. Create More.<br>
              This is a transactional email about your Rentivo booking.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;background:#003049;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:12px;">${label}</a>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function send(to: string, subject: string, html: string) {
  if (!isEmailConfigured()) {
    console.log(`[email] RESEND_API_KEY not set — skipped "${subject}" to ${to}`)
    return
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({ from: FROM, to, subject, html })
    if (error) console.error('[email] send failed', error)
  } catch (err) {
    console.error('[email] send threw', err)
  }
}

interface EmailContext {
  bookingRef: string
  listingTitle: string
  pickupDate: string
  returnDate: string
  totalAmount: number
  otherPartyName: string
}

function hostNewBookingHtml(ctx: EmailContext, instant: boolean) {
  return layout(
    `${instant ? 'New paid booking' : 'New booking request'} for ${ctx.listingTitle}`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">${instant ? 'New Instant Booking 🎉' : 'New Booking Request'}</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${ctx.otherPartyName}</strong> ${instant ? 'just booked' : 'wants to rent'} your <strong>${ctx.listingTitle}</strong>.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ctx.bookingRef}<br>
       Rental amount: ${fmtPeso(ctx.totalAmount)} (paid)
     </p>
     ${instant
       ? `<p style="margin:0;color:#4b5563;font-size:14px;">This booking is already confirmed — no action needed.</p>`
       : `<p style="margin:0;color:#4b5563;font-size:14px;">Please confirm or decline within 24 hours.</p>${button(`${APP_URL}/dashboard/bookings`, 'Review Booking')}`}`
  )
}

function hostQrBookingRequestedHtml(ctx: EmailContext) {
  return layout(
    `New booking request for ${ctx.listingTitle} — awaiting QR payment`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">New Booking Request</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${ctx.otherPartyName}</strong> wants to rent your <strong>${ctx.listingTitle}</strong>, paying you directly via your GCash/Maya QR code.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ctx.bookingRef}<br>
       Amount due: ${fmtPeso(ctx.totalAmount)} (Rentivo does not process this payment)
     </p>
     <p style="margin:0;color:#4b5563;font-size:14px;">Once you've received the payment, mark it received in your dashboard.</p>
     ${button(`${APP_URL}/dashboard/bookings`, 'Review Booking')}`
  )
}

function renterConfirmedHtml(ctx: EmailContext) {
  return layout(
    `Your booking ${ctx.bookingRef} is confirmed`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Booking Confirmed ✅</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       Your rental of <strong>${ctx.listingTitle}</strong> from <strong>${ctx.otherPartyName}</strong> is confirmed.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ctx.bookingRef}<br>
       Total paid: ${fmtPeso(ctx.totalAmount)}
     </p>
     ${button(`${APP_URL}/dashboard/rentals`, 'View Booking')}`
  )
}

function renterPendingHtml(ctx: EmailContext) {
  return layout(
    `Payment received for ${ctx.bookingRef} — awaiting host confirmation`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Payment Received</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       We've received your payment for <strong>${ctx.listingTitle}</strong>. ${ctx.otherPartyName} will confirm your booking within 24 hours.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ctx.bookingRef}<br>
       Total paid: ${fmtPeso(ctx.totalAmount)}
     </p>
     ${button(`${APP_URL}/dashboard/rentals`, 'View Booking')}`
  )
}

function refundLine(totalAmount: number, refunded: boolean, isHostQr: boolean) {
  if (isHostQr) {
    return refunded
      ? `This booking was paid directly to the host via QR code, so Rentivo can’t process a refund automatically — please arrange the ${fmtPeso(totalAmount)} refund directly with your host.`
      : `You have not been charged further by Rentivo. Since this booking was paid directly to the host via QR code, any refund of ${fmtPeso(totalAmount)} needs to be arranged directly with them.`
  }
  return refunded
    ? `A refund of ${fmtPeso(totalAmount)} has been processed back to your original payment method — it usually takes 5–10 business days to reflect, depending on your bank or e-wallet.`
    : `You have not been charged further. Our team will follow up to process a refund of ${fmtPeso(totalAmount)} to your original payment method.`
}

function renterDeclinedHtml(ctx: EmailContext, refunded: boolean, isHostQr: boolean) {
  return layout(
    `Your booking ${ctx.bookingRef} was declined`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Booking Declined</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       ${ctx.otherPartyName} was unable to confirm your booking for <strong>${ctx.listingTitle}</strong>
       (${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}, ref ${ctx.bookingRef}).
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${refundLine(ctx.totalAmount, refunded, isHostQr)}
     </p>
     ${button(`${APP_URL}/search`, 'Browse Other Equipment')}`
  )
}

function hostCancelledByRenterHtml(ctx: EmailContext, refunded: boolean, isHostQr: boolean) {
  return layout(
    `Booking ${ctx.bookingRef} was cancelled by the renter`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Booking Cancelled</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${ctx.otherPartyName}</strong> cancelled their booking for <strong>${ctx.listingTitle}</strong>
       (${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}, ref ${ctx.bookingRef}). The dates are open again.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${isHostQr
         ? 'This booking was paid directly to you via QR code, so no payment ever passed through Rentivo — please refund the renter directly if you’ve already received payment.'
         : refunded ? 'The renter has been refunded in full.' : 'The renter\'s refund is being processed.'}
     </p>
     ${button(`${APP_URL}/dashboard/calendar`, 'View Calendar')}`
  )
}

function newMessageHtml(ctx: { senderName: string; listingTitle: string; preview: string; conversationId: string }) {
  const senderName = escapeHtml(ctx.senderName)
  const listingTitle = escapeHtml(ctx.listingTitle)
  const preview = escapeHtml(ctx.preview)
  return layout(
    `New message from ${senderName}`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">New Message 💬</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${senderName}</strong> sent you a message about <strong>${listingTitle}</strong>.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;font-style:italic;">
       "${preview}"
     </p>
     ${button(`${APP_URL}/dashboard/messages?conversation=${escapeHtml(ctx.conversationId)}`, 'Reply')}`
  )
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
  listing: { title: string; is_instant_book: boolean } | null
}

async function loadBookingContext(bookingId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('bookings')
    .select(
      'id, booking_ref, renter_id, host_id, pickup_date, return_date, total_amount, payment_method, listing:listings(title, is_instant_book)'
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
  const instant = booking.listing?.is_instant_book ?? false
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
          hostNewBookingHtml({ ...base, otherPartyName: renterName }, instant)
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
 * Call right after a host_qr booking is created (pending/unpaid) — the one
 * moment in this payment path analogous to what notifyBookingPaid covers
 * for PayMongo methods, except payment hasn't happened yet: the host needs
 * to know a booking exists and is waiting on their own QR-payment
 * confirmation. The renter gets no email here — Step4Confirmation already
 * shows them the QR immediately, in-app, at the moment they need it.
 */
export async function notifyHostQrBookingRequested(bookingId: string) {
  const ctx = await loadBookingContext(bookingId)
  if (!ctx) return
  const { booking, hostEmail, renterName, hostNotifyNewBooking } = ctx

  if (!hostNotifyNewBooking) {
    console.log(`[email] skipped host QR-booking-requested email — notify_new_booking off for booking ${booking.id}`)
    return
  }

  await send(
    hostEmail,
    `New Booking Request — ${booking.booking_ref}`,
    hostQrBookingRequestedHtml({
      bookingRef: booking.booking_ref,
      listingTitle: booking.listing?.title ?? 'a listing',
      pickupDate: booking.pickup_date,
      returnDate: booking.return_date,
      totalAmount: booking.total_amount,
      otherPartyName: renterName,
    })
  )
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

function adminDecisionHtml(opts: {
  heading: string
  bodyHtml: string
  ctaPath: string
  ctaLabel: string
}) {
  return layout(
    opts.heading,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">${opts.heading}</h1>
     ${opts.bodyHtml}
     ${button(`${APP_URL}${opts.ctaPath}`, opts.ctaLabel)}`
  )
}

async function emailForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email ?? null
}

const notesBlock = (notes: string | null) =>
  notes
    ? `<p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">Reviewer notes: ${escapeHtml(notes)}</p>`
    : ''

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
        ? `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your payout account was verified — you can now request payouts for your completed bookings.</p>`
        : `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">We couldn't verify your payout account. Please update it and it will be re-reviewed.</p>${notesBlock(notes)}`,
      ctaPath: '/dashboard/payouts',
      ctaLabel: 'Go to Payouts',
    })
  )
}

export async function notifyPayoutPaid(hostId: string, amount: number, reference: string | null) {
  const to = await emailForUser(hostId)
  if (!to) return
  await send(
    to,
    `Your payout of ${fmtPeso(amount)} has been sent`,
    adminDecisionHtml({
      heading: 'Payout Sent 💸',
      bodyHtml: `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">
          Your payout of <strong>${fmtPeso(amount)}</strong> has been sent to your payout account.
          ${reference ? `<br>Reference: ${escapeHtml(reference)}` : ''}
        </p>`,
      ctaPath: '/dashboard/payouts',
      ctaLabel: 'View Payout History',
    })
  )
}

export async function notifyPayoutFailed(hostId: string, amount: number, notes: string | null) {
  const to = await emailForUser(hostId)
  if (!to) return
  await send(
    to,
    `Your payout of ${fmtPeso(amount)} could not be completed`,
    adminDecisionHtml({
      heading: 'Payout Failed',
      bodyHtml: `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">
          Your payout of <strong>${fmtPeso(amount)}</strong> couldn't be completed. The bookings it covered
          are eligible again — please check your payout account details and request again.
        </p>${notesBlock(notes)}`,
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
