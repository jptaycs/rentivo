/**
 * Decision logic for PayMongo `payment.paid` webhook events, kept free of
 * framework and database imports so it can be exercised directly by
 * scripts/verify/paymongo-webhook.mjs with fake dependencies. The route
 * (src/app/api/webhooks/paymongo/route.ts) wires the real ones in.
 *
 * Why a fallback exists (security audit 2, MEDIUM-4): every checkout retry for
 * the same booking mints a NEW payment intent and overwrites
 * `bookings.paymongo_ref`. A renter who shows QR #1, retries (QR #2), then
 * scans QR #1 is really charged — but a lookup by `paymongo_ref` alone finds
 * no booking, and the money used to vanish without a trace. Checkout puts
 * `metadata.booking_id` on every intent, so an unmatched event falls back to
 * that — but ONLY after re-reading the intent from PayMongo and confirming the
 * amount, currency and status agree with the booking. Metadata alone is never
 * enough to mark a booking paid.
 *
 * `mark_booking_paid` (service-role, idempotent) stays the only path to 'paid'.
 */

export interface WebhookBooking {
  id: string
  payment_status: string
  status: string
  total_amount: number
  paymongo_ref: string | null
}

export interface WebhookIntent {
  id: string
  attributes: {
    status: string
    amount: number
    currency: string
    metadata: Record<string, string> | null
  }
}

/** The `payment` resource embedded in the event (data.attributes.data). */
export interface WebhookPayment {
  amount?: number
  currency?: string
}

export type FallbackCheck = { ok: true } | { ok: false; reason: string }

/**
 * Does this (PayMongo-fetched) intent really pay for this booking? Every check
 * must pass; any disagreement means a human must look, not that we guess.
 */
export function checkIntentPaysBooking(
  intent: WebhookIntent,
  booking: WebhookBooking,
  payment?: WebhookPayment | null
): FallbackCheck {
  const a = intent.attributes
  if (a.metadata?.booking_id !== booking.id) {
    return { ok: false, reason: 'intent metadata.booking_id does not name this booking' }
  }
  if (a.status !== 'succeeded') {
    return { ok: false, reason: `intent status is ${a.status}, not succeeded` }
  }
  if (a.currency !== 'PHP') {
    return { ok: false, reason: `intent currency is ${a.currency}, not PHP` }
  }
  const expected = Math.round(Number(booking.total_amount) * 100)
  if (!Number.isFinite(expected) || expected <= 0 || a.amount !== expected) {
    return { ok: false, reason: `intent amount ${a.amount} != booking total ${expected} centavos` }
  }
  if (payment && payment.amount !== undefined && payment.amount !== a.amount) {
    return { ok: false, reason: `event payment amount ${payment.amount} != intent amount ${a.amount}` }
  }
  if (payment && payment.currency !== undefined && payment.currency !== a.currency) {
    return { ok: false, reason: `event payment currency ${payment.currency} != intent currency ${a.currency}` }
  }
  return { ok: true }
}

export interface PaymentPaidDeps {
  findBookingByRef(intentId: string): Promise<WebhookBooking | null>
  findBookingById(bookingId: string): Promise<WebhookBooking | null>
  getIntent(intentId: string): Promise<WebhookIntent>
  markPaid(bookingId: string, intentId: string): Promise<{ error: string | null }>
  notifyPaid(bookingId: string): void
  /** Must be loud (console.error in production) — real money may be unaccounted for. */
  alert(message: string, detail: Record<string, unknown>): void
}

export type PaymentPaidOutcome =
  | 'marked_paid'
  | 'already_paid'
  | 'marked_paid_via_metadata'
  | 'unmatched'
  | 'refused'
  | 'mark_failed'
  | 'retry'

/**
 * Handle one verified `payment.paid` event. Returns what happened; `retry`
 * means the caller should answer non-2xx so PayMongo redelivers (a transient
 * failure reading the intent — never used for a permanent mismatch).
 */
export async function handlePaymentPaid(
  intentId: string,
  payment: WebhookPayment | null,
  deps: PaymentPaidDeps
): Promise<PaymentPaidOutcome> {
  const byRef = await deps.findBookingByRef(intentId)
  if (byRef) {
    if (byRef.payment_status === 'paid') return 'already_paid'
    const { error } = await deps.markPaid(byRef.id, intentId)
    if (error) {
      deps.alert('payment.paid matched a booking but mark_booking_paid failed', {
        intentId,
        bookingId: byRef.id,
        error,
      })
      return 'mark_failed'
    }
    deps.notifyPaid(byRef.id)
    return 'marked_paid'
  }

  // No booking carries this ref — most likely an earlier intent from a
  // checkout retry. Re-read the intent from PayMongo rather than trusting the
  // event body for the amount and metadata.
  let intent: WebhookIntent
  try {
    intent = await deps.getIntent(intentId)
  } catch (err) {
    deps.alert('payment.paid matched no booking and the intent could not be fetched — will retry', {
      intentId,
      error: err instanceof Error ? err.message : String(err),
    })
    return 'retry'
  }

  const bookingId = intent.attributes.metadata?.booking_id
  const booking = bookingId ? await deps.findBookingById(bookingId) : null
  if (!booking) {
    deps.alert('UNMATCHED PAYMENT: payment.paid matched no booking by ref or metadata — reconcile manually', {
      intentId,
      metadataBookingId: bookingId ?? null,
      amount: intent.attributes.amount,
      currency: intent.attributes.currency,
    })
    return 'unmatched'
  }

  const check = checkIntentPaysBooking(intent, booking, payment)
  if (!check.ok) {
    deps.alert('REFUSED PAYMENT FALLBACK: intent does not match the booking its metadata names — reconcile manually', {
      intentId,
      bookingId: booking.id,
      reason: check.reason,
    })
    return 'refused'
  }

  if (booking.payment_status !== 'unpaid') {
    // e.g. paid through a later intent too — the renter has paid twice.
    deps.alert('DUPLICATE PAYMENT: a stale intent was paid for a booking that is no longer unpaid — refund manually', {
      intentId,
      bookingId: booking.id,
      bookingPaymentStatus: booking.payment_status,
      bookingRef: booking.paymongo_ref,
      amount: intent.attributes.amount,
    })
    return 'refused'
  }

  const { error } = await deps.markPaid(booking.id, intentId)
  if (error) {
    deps.alert('payment.paid matched a booking via metadata but mark_booking_paid failed — reconcile manually', {
      intentId,
      bookingId: booking.id,
      bookingStatus: booking.status,
      error,
    })
    return 'mark_failed'
  }
  deps.notifyPaid(booking.id)
  return 'marked_paid_via_metadata'
}
