import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Thin server-side client for the PayMongo REST API.
 * https://developers.paymongo.com/reference
 *
 * Amounts are in centavos (PHP × 100). Card payment methods are
 * created in the browser with the public key so card data never
 * touches this server; e-wallet payment methods are created here.
 */

const BASE_URL = 'https://api.paymongo.com/v1'

export type PayMongoIntentStatus =
  | 'awaiting_payment_method'
  | 'awaiting_next_action'
  | 'processing'
  | 'succeeded'

export interface PaymentIntent {
  id: string
  attributes: {
    status: PayMongoIntentStatus
    amount: number
    currency: string
    next_action:
      | { type: 'redirect'; redirect: { url: string; return_url: string } }
      | { type: string; code: { image_url: string } }
      | null
    last_payment_error: { failed_message?: string } | Record<string, unknown> | null
    metadata: Record<string, string> | null
    /** The underlying charge(s) — refunds target a payment id (pay_...), not the intent (pi_...) */
    payments?: { id: string }[]
  }
}

export interface PaymentMethod {
  id: string
  attributes: { type: string }
}

export interface Refund {
  id: string
  attributes: { status: string; amount: number }
}

export function isPayMongoConfigured() {
  return Boolean(process.env.PAYMONGO_SECRET_KEY)
}

export class PayMongoError extends Error {
  /** HTTP status PayMongo answered with (503 when the secret key is missing). */
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'PayMongoError'
    this.status = status
  }
}

/**
 * True when PayMongo rejected the request because the payment method type
 * isn't activated on this merchant account (gcash/maya/card are pending KYB
 * approval — see AGENTS.md). PayMongo doesn't publish a stable error code for
 * this, so it's a wording heuristic over the `errors[].detail` text: a 4xx
 * whose detail talks about a payment method being not enabled/activated/
 * allowed/available. Anything that doesn't match falls through to the caller's
 * generic handling, so a false negative only costs message quality.
 */
export function isMethodNotActivatedError(err: unknown): err is PayMongoError {
  if (!(err instanceof PayMongoError)) return false
  if (err.status < 400 || err.status >= 500) return false
  const text = err.message.toLowerCase()
  const aboutMethod = /payment[_ ]?method|gcash|paymaya|maya|card|qrph|qr ph/.test(text)
  const rejected =
    /not (yet )?(activated|enabled|available|allowed|supported|active)|disabled|inactive|unsupported/.test(
      text
    )
  return aboutMethod && rejected
}

async function pmFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const secret = process.env.PAYMONGO_SECRET_KEY
  if (!secret) throw new PayMongoError('PAYMONGO_SECRET_KEY is not configured.', 503)

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail =
      json?.errors?.map((e: { detail?: string }) => e.detail).filter(Boolean).join(' ') ||
      `PayMongo request failed (${res.status})`
    throw new PayMongoError(detail, res.status)
  }
  return json.data as T
}

export function createPaymentIntent(opts: {
  amountCentavos: number
  description: string
  metadata?: Record<string, string>
}) {
  return pmFetch<PaymentIntent>('/payment_intents', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          amount: opts.amountCentavos,
          currency: 'PHP',
          payment_method_allowed: ['card', 'gcash', 'paymaya', 'qrph'],
          payment_method_options: { card: { request_three_d_secure: 'any' } },
          capture_type: 'automatic',
          description: opts.description,
          statement_descriptor: 'Rentivo',
          metadata: opts.metadata,
        },
      },
    },
  })
}

/** GCash / Maya payment methods hold no sensitive data, so the server creates them. */
export function createEwalletPaymentMethod(opts: {
  type: 'gcash' | 'paymaya'
  name: string
  email?: string
  phone?: string
}) {
  return pmFetch<PaymentMethod>('/payment_methods', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          type: opts.type,
          billing: { name: opts.name, email: opts.email, phone: opts.phone },
        },
      },
    },
  })
}

/**
 * QR Ph payment methods hold no billing data — the customer scans a
 * PayMongo-generated QR code with any QR Ph-participating bank/e-wallet
 * app, so unlike GCash/Maya there's no phone/account to attach up front.
 */
export function createQrPhPaymentMethod() {
  return pmFetch<PaymentMethod>('/payment_methods', {
    method: 'POST',
    body: {
      data: {
        attributes: { type: 'qrph' },
      },
    },
  })
}

export function attachPaymentIntent(intentId: string, paymentMethodId: string, returnUrl: string) {
  return pmFetch<PaymentIntent>(`/payment_intents/${intentId}/attach`, {
    method: 'POST',
    body: {
      data: {
        attributes: { payment_method: paymentMethodId, return_url: returnUrl },
      },
    },
  })
}

export function getPaymentIntent(intentId: string) {
  return pmFetch<PaymentIntent>(`/payment_intents/${intentId}`)
}

/** Full refund of a completed charge. `paymentId` is the `pay_...` id from the intent's `payments[]`, not the intent id itself. */
export function createRefund(opts: {
  paymentId: string
  amountCentavos: number
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent' | 'others'
  notes?: string
}) {
  return pmFetch<Refund>('/refunds', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          amount: opts.amountCentavos,
          payment_id: opts.paymentId,
          reason: opts.reason ?? 'requested_by_customer',
          notes: opts.notes,
        },
      },
    },
  })
}

export function paymentErrorMessage(intent: PaymentIntent): string {
  const err = intent.attributes.last_payment_error as { failed_message?: string } | null
  return err?.failed_message || 'Payment was not completed. Please try again.'
}

/** How far a webhook's signed timestamp may be from our clock, in seconds. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

export type WebhookSignatureResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' | 'stale' }

/**
 * Verify a `Paymongo-Signature: t=<ts>,te=<test hmac>,li=<live hmac>` header
 * against the raw request body using the webhook secret (whsk_...).
 *
 * The HMAC is compared in constant time. AFTER the signature verifies, the
 * signed timestamp `t` must be within WEBHOOK_TOLERANCE_SECONDS of now — without
 * that, a captured signed event could be replayed forever (security audit 2,
 * LOW-8). The order matters: an unsigned request never learns whether its
 * timestamp would have been acceptable.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now()
): WebhookSignatureResult {
  if (!header) return { ok: false, reason: 'missing' }
  const parts: Record<string, string> = {}
  for (const piece of header.split(',')) {
    const eq = piece.indexOf('=')
    if (eq <= 0) continue
    parts[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim()
  }
  const { t, te, li } = parts
  if (!t || !/^\d{1,12}$/.test(t)) return { ok: false, reason: 'malformed' }

  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'))
  let signatureOk = false
  for (const candidate of [te, li]) {
    if (!candidate) continue
    const b = Buffer.from(candidate)
    if (expected.length === b.length && timingSafeEqual(expected, b)) signatureOk = true
  }
  if (!signatureOk) return { ok: false, reason: 'invalid' }

  if (Math.abs(nowMs / 1000 - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale' }
  }
  return { ok: true }
}
