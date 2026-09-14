/**
 * Pure HTML builders for every transactional email Rentivo sends.
 *
 * Split out of src/lib/email.ts (which is `server-only` and pulls in Resend and
 * the service-role client) so the templates can be exercised on their own by
 * scripts/verify/audit2-email-escaping.mjs. No imports, no side effects.
 *
 * ⚠️ ESCAPING RULE — every value that did not originate as a string literal in
 * THIS file is untrusted and must go through `escapeHtml` AT THE POINT OF
 * INTERPOLATION. That includes profile names (`profiles.full_name` is set by the
 * user), listing titles (typed by the host), message text, admin notes, payout
 * references, booking refs and conversation ids. Security audit 2 (MEDIUM-1)
 * found five booking templates plus the preheader interpolating names and
 * titles raw, so a user could name themselves
 * `<a href="https://evil.example.com">Verify your payment</a>` and have Rentivo
 * deliver that link in a DKIM-signed email from noreply@rentivo.live. Escaping
 * at the interpolation site (never "the caller already escaped it") is what
 * keeps a new template from reopening that.
 */

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Email subjects are plain text, but they are built from user-set values (a
 * sender's name). Collapse every control character — CR/LF above all — to a
 * space so nothing can smuggle a second header line or a multi-line subject,
 * then cap the length.
 */
export function plainSubject(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    out += code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029 ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 200)
}

export const fmtPeso = (n: number) => `₱${Number(n).toLocaleString('en-PH')}`
const fmtDate = (d: string) =>
  escapeHtml(new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }))

/** `preheader` is raw text — layout escapes it. `bodyHtml` must already be safe HTML. */
function layout(preheader: string, bodyHtml: string) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
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

/** Both arguments are escaped; pass raw values. */
function button(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:20px;background:#003049;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:12px;">${escapeHtml(label)}</a>`
}

export interface EmailContext {
  bookingRef: string
  listingTitle: string
  pickupDate: string
  returnDate: string
  totalAmount: number
  otherPartyName: string
}

/**
 * A delivery booking's destination, for the host. The address is typed by the
 * renter, so it is untrusted like every other value here. Deliberately no
 * coordinates and no map link: a link in an inbox outlives any access control,
 * and the in-app bookings page (paid bookings only) is where the pin lives.
 */
export interface DeliveryDetails {
  address: string | null
  /** Stored road km; null for flat-fee delivery. */
  distanceKm: number | null
  fee: number
}

function deliveryBlock(d: DeliveryDetails) {
  // Escape FIRST, then turn the renter's own line breaks into <br>; the
  // replacement only ever inserts our literal tag into already-escaped text.
  const address = d.address?.trim()
    ? escapeHtml(d.address.trim()).replace(/\r\n|\r|\n/g, '<br>')
    : 'No address given — message the renter before you accept.'
  const distance = d.distanceKm != null ? `${escapeHtml(Number(d.distanceKm))} km` : null
  return `<p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>Delivery to:</strong><br>${address}<br>
       Delivery fee: ${escapeHtml(fmtPeso(d.fee))}${distance ? ` (${distance})` : ''}
     </p>
     ${distance
       ? `<p style="margin:0 0 16px;color:#92400e;font-size:13px;line-height:1.6;">The delivery fee was calculated from the renter's map pin. Check the pin matches this address on your Bookings page.</p>`
       : ''}`
}

export function hostNewBookingHtml(ctx: EmailContext, instant: boolean, delivery?: DeliveryDetails | null) {
  const name = escapeHtml(ctx.otherPartyName)
  const title = escapeHtml(ctx.listingTitle)
  const ref = escapeHtml(ctx.bookingRef)
  return layout(
    `${instant ? 'New paid booking' : 'New booking request'} for ${ctx.listingTitle}`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">${instant ? 'New Instant Booking 🎉' : 'New Booking Request'}</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${name}</strong> ${instant ? 'just booked' : 'wants to rent'} your <strong>${title}</strong>.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ref}<br>
       Rental amount: ${fmtPeso(ctx.totalAmount)} (paid)
     </p>
     ${delivery ? deliveryBlock(delivery) : ''}
     ${instant
       ? `<p style="margin:0;color:#4b5563;font-size:14px;">This booking is already confirmed — no action needed.</p>`
       : `<p style="margin:0;color:#4b5563;font-size:14px;">Please confirm or decline within 24 hours.</p>${button(`${APP_URL}/dashboard/bookings`, 'Review Booking')}`}`
  )
}

export function renterConfirmedHtml(ctx: EmailContext) {
  const name = escapeHtml(ctx.otherPartyName)
  const title = escapeHtml(ctx.listingTitle)
  const ref = escapeHtml(ctx.bookingRef)
  return layout(
    `Your booking ${ctx.bookingRef} is confirmed`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Booking Confirmed ✅</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       Your rental of <strong>${title}</strong> from <strong>${name}</strong> is confirmed.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ref}<br>
       Total paid: ${fmtPeso(ctx.totalAmount)}
     </p>
     ${button(`${APP_URL}/dashboard/rentals`, 'View Booking')}`
  )
}

export function renterPendingHtml(ctx: EmailContext) {
  const name = escapeHtml(ctx.otherPartyName)
  const title = escapeHtml(ctx.listingTitle)
  const ref = escapeHtml(ctx.bookingRef)
  return layout(
    `Payment received for ${ctx.bookingRef} — awaiting host confirmation`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Payment Received</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       We've received your payment for <strong>${title}</strong>. ${name} will confirm your booking within 24 hours.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}<br>
       Booking ref: ${ref}<br>
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

export function renterDeclinedHtml(ctx: EmailContext, refunded: boolean, isHostQr: boolean) {
  const name = escapeHtml(ctx.otherPartyName)
  const title = escapeHtml(ctx.listingTitle)
  const ref = escapeHtml(ctx.bookingRef)
  return layout(
    `Your booking ${ctx.bookingRef} was declined`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Booking Declined</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       ${name} was unable to confirm your booking for <strong>${title}</strong>
       (${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}, ref ${ref}).
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${refundLine(ctx.totalAmount, refunded, isHostQr)}
     </p>
     ${button(`${APP_URL}/search`, 'Browse Other Equipment')}`
  )
}

export function hostCancelledByRenterHtml(ctx: EmailContext, refunded: boolean, isHostQr: boolean) {
  const name = escapeHtml(ctx.otherPartyName)
  const title = escapeHtml(ctx.listingTitle)
  const ref = escapeHtml(ctx.bookingRef)
  return layout(
    `Booking ${ctx.bookingRef} was cancelled by the renter`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Booking Cancelled</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${name}</strong> cancelled their booking for <strong>${title}</strong>
       (${fmtDate(ctx.pickupDate)} → ${fmtDate(ctx.returnDate)}, ref ${ref}). The dates are open again.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
       ${isHostQr
         ? 'This booking was paid directly to you via QR code, so no payment ever passed through Rentivo — please refund the renter directly if you’ve already received payment.'
         : refunded ? 'The renter has been refunded in full.' : 'The renter\'s refund is being processed.'}
     </p>
     ${button(`${APP_URL}/dashboard/calendar`, 'View Calendar')}`
  )
}

export function newMessageHtml(ctx: { senderName: string; listingTitle: string; preview: string; conversationId: string }) {
  const senderName = escapeHtml(ctx.senderName)
  const listingTitle = escapeHtml(ctx.listingTitle)
  const preview = escapeHtml(ctx.preview)
  return layout(
    `New message from ${ctx.senderName}`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">New Message 💬</h1>
     <p style="margin:0 0 4px;color:#4b5563;font-size:14px;line-height:1.6;">
       <strong>${senderName}</strong> sent you a message about <strong>${listingTitle}</strong>.
     </p>
     <p style="margin:16px 0;color:#4b5563;font-size:14px;line-height:1.6;font-style:italic;">
       "${preview}"
     </p>
     ${button(`${APP_URL}/dashboard/messages?conversation=${encodeURIComponent(ctx.conversationId)}`, 'Reply')}`
  )
}

// ── Admin-decision outcome emails ─────────────────────────────

/** `heading` is raw text (escaped here); `bodyHtml` must already be safe HTML. */
export function adminDecisionHtml(opts: {
  heading: string
  bodyHtml: string
  ctaPath: string
  ctaLabel: string
}) {
  return layout(
    opts.heading,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">${escapeHtml(opts.heading)}</h1>
     ${opts.bodyHtml}
     ${button(`${APP_URL}${opts.ctaPath}`, opts.ctaLabel)}`
  )
}

export const notesBlock = (notes: string | null) =>
  notes
    ? `<p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">Reviewer notes: ${escapeHtml(notes)}</p>`
    : ''

// ── Payout statements (082) ───────────────────────────────────

/**
 * Everything both statement emails render. Every figure here is a SNAPSHOT
 * taken when the draft was prepared — never a live join back to bookings or
 * listings. A host reading this email a month later must see what was paid,
 * not what the listing happens to be called today.
 *
 * `accountLabel` arrives already masked ("GCash •••• 4567"). The full account
 * number must never reach this module: an inbox is the least private place
 * that data could travel.
 */
export interface PayoutStatementEmailContext {
  hostName: string
  statementNumber: string
  amount: number
  transferredOn: string
  reference: string
  accountLabel: string
  grossBookingValue: number
  serviceFeeTotal: number
  deliveryFeeTotal: number
  requestId: string
  items: {
    bookingRef: string
    listingTitle: string
    pickupDate: string
    returnDate: string
    rentalFee: number
    deliveryFee: number
    serviceFee: number
    earnings: number
  }[]
  /** Reversed only. */
  reversedOn?: string
  reversalReason?: string
}

/**
 * Date-only columns (`transferred_on`, `pickup_date`, `return_date`) are plain
 * 'YYYY-MM-DD'. `new Date()` reads those as UTC midnight, which renders as the
 * previous day west of Greenwich — so parse by parts, exactly as
 * PayoutStatement.tsx does, or the emailed copy and the document disagree.
 */
function fmtStatementDate(value: string, month: 'short' | 'long' = 'long') {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return escapeHtml(d.toLocaleDateString('en-PH', { month, day: 'numeric', year: 'numeric' }))
}

const cell = 'padding:8px 0;font-size:12px;color:#111827;'
const numCell = `${cell}text-align:right;white-space:nowrap;padding-left:8px;`

/** Booking refs and listing titles are host-authored; both are escaped here. */
function statementBookingTable(ctx: PayoutStatementEmailContext) {
  const rows = ctx.items
    .map(
      (item) => `<tr style="border-top:1px solid #f1f4f8;">
              <td style="${cell}vertical-align:top;">
                <span style="font-weight:700;letter-spacing:0.05em;">${escapeHtml(item.bookingRef)}</span><br>
                <span style="color:#6b7280;">${escapeHtml(item.listingTitle)}</span><br>
                <span style="color:#9aa3af;">${fmtStatementDate(item.pickupDate, 'short')} – ${fmtStatementDate(item.returnDate, 'short')}</span>
              </td>
              <td style="${numCell}vertical-align:top;">${escapeHtml(fmtPeso(item.rentalFee))}</td>
              <td style="${numCell}vertical-align:top;">${escapeHtml(fmtPeso(item.deliveryFee))}</td>
              <td style="${numCell}vertical-align:top;color:#6b7280;">${escapeHtml(fmtPeso(item.serviceFee))}</td>
              <td style="${numCell}vertical-align:top;font-weight:700;">${escapeHtml(fmtPeso(item.earnings))}</td>
            </tr>`
    )
    .join('')
  return `<p style="margin:24px 0 8px;color:#9aa3af;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Bookings (${escapeHtml(ctx.items.length)})</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
       <tr>
         <th align="left" style="${cell}color:#9aa3af;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Booking</th>
         <th align="right" style="${numCell}color:#9aa3af;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Rental</th>
         <th align="right" style="${numCell}color:#9aa3af;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Delivery</th>
         <th align="right" style="${numCell}color:#9aa3af;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Fee</th>
         <th align="right" style="${numCell}color:#9aa3af;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Earnings</th>
       </tr>
       ${rows}
     </table>`
}

/**
 * The four summary lines of spec §8, in the document's order and with its
 * definitions: gross is what renters paid, the fee is what Rentivo kept, and
 * the difference is exactly what was transferred. If the items don't reconcile
 * to the recorded amount, say so — PayoutStatement.tsx does the same rather
 * than printing a number nobody can check.
 */
function statementSummary(ctx: PayoutStatementEmailContext) {
  const net = ctx.grossBookingValue - ctx.serviceFeeTotal
  const line = (label: string, value: string, style = '') =>
    `<tr><td style="padding:4px 0;color:#4b5563;font-size:13px;${style}">${label}</td>
         <td style="padding:4px 0;color:#111827;font-size:13px;text-align:right;white-space:nowrap;${style}">${value}</td></tr>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:20px;border-top:1px solid #eef1f5;padding-top:8px;">
       ${line('Gross booking value', escapeHtml(fmtPeso(ctx.grossBookingValue)))}
       ${line('Less: Rentivo service fee', `−${escapeHtml(fmtPeso(ctx.serviceFeeTotal))}`)}
       ${line('&nbsp;&nbsp;of which delivery fees (paid to you in full)', escapeHtml(fmtPeso(ctx.deliveryFeeTotal)), 'color:#9aa3af;')}
       ${line('<strong>Net paid to you</strong>', `<strong>${escapeHtml(fmtPeso(net))}</strong>`, 'border-top:1px solid #eef1f5;padding-top:10px;')}
     </table>
     ${net !== ctx.amount
       ? `<p style="margin:16px 0 0;color:#b91c1c;font-size:13px;line-height:1.6;font-weight:700;">The bookings listed total ${escapeHtml(fmtPeso(net))} but ${escapeHtml(fmtPeso(ctx.amount))} was recorded as transferred. Please reply to this email.</p>`
       : ''}
     <p style="margin:16px 0 0;color:#9aa3af;font-size:12px;line-height:1.6;">
       The service fee was charged to renters on top of your rental price at checkout. It was not deducted from your rental rate.
     </p>`
}

export function payoutStatementIssuedHtml(ctx: PayoutStatementEmailContext) {
  return layout(
    `Payout statement ${ctx.statementNumber} — ${fmtPeso(ctx.amount)} sent to your payout account`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Payout Sent 💸</h1>
     <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
       Hi ${escapeHtml(ctx.hostName)}, we've sent <strong>${escapeHtml(fmtPeso(ctx.amount))}</strong> to your payout account.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F8FAFC;border-radius:12px;">
       <tr><td style="padding:16px;color:#4b5563;font-size:13px;line-height:1.7;">
         Statement: <strong style="letter-spacing:0.05em;">${escapeHtml(ctx.statementNumber)}</strong><br>
         Transfer date: ${fmtStatementDate(ctx.transferredOn)}<br>
         Reference: ${escapeHtml(ctx.reference)}<br>
         Sent to: ${escapeHtml(ctx.accountLabel)}
       </td></tr>
     </table>
     ${statementBookingTable(ctx)}
     ${statementSummary(ctx)}
     ${button(`${APP_URL}/dashboard/payouts/${ctx.requestId}`, 'View Statement')}`
  )
}

export function payoutStatementReversedHtml(ctx: PayoutStatementEmailContext) {
  return layout(
    `Payout statement ${ctx.statementNumber} was reversed`,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">Payout Reversed</h1>
     <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
       Hi ${escapeHtml(ctx.hostName)}, the payout of <strong>${escapeHtml(fmtPeso(ctx.amount))}</strong> recorded under statement
       <strong style="letter-spacing:0.05em;">${escapeHtml(ctx.statementNumber)}</strong> was reversed${ctx.reversedOn ? ` on ${fmtStatementDate(ctx.reversedOn)}` : ''}.
       That money is not yours to spend — if it reached your account, it is being taken back.
     </p>
     ${ctx.reversalReason
       ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fef2f2;border-radius:12px;">
            <tr><td style="padding:16px;color:#b91c1c;font-size:13px;line-height:1.6;">
              <strong>Reason:</strong> ${escapeHtml(ctx.reversalReason)}
            </td></tr>
          </table>`
       : ''}
     <p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">
       The bookings this statement covered are <strong>owed to you again</strong> and will appear on a future statement.
       Please check your payout account details are correct — a wrong or closed account is the usual reason a transfer
       has to be reversed.
     </p>
     <p style="margin:16px 0 0;color:#4b5563;font-size:13px;line-height:1.7;">
       Original transfer date: ${fmtStatementDate(ctx.transferredOn)}<br>
       Reference: ${escapeHtml(ctx.reference)}<br>
       Payout account: ${escapeHtml(ctx.accountLabel)}
     </p>
     ${statementBookingTable(ctx)}
     ${button(`${APP_URL}/dashboard/payouts/${ctx.requestId}`, 'View Statement')}`
  )
}
