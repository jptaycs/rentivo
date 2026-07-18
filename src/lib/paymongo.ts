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
    next_action: { type: string; redirect: { url: string; return_url: string } } | null
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

class PayMongoError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'PayMongoError'
  }
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
          payment_method_allowed: ['card', 'gcash', 'paymaya'],
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

/**
 * Verify a `Paymongo-Signature: t=<ts>,te=<test hmac>,li=<live hmac>` header
 * against the raw request body using the webhook secret (whsk_...).
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string) {
  if (!header) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=', 2) as [string, string])
  )
  const { t, te, li } = parts
  if (!t) return false

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  for (const candidate of [te, li]) {
    if (!candidate) continue
    const a = Buffer.from(expected)
    const b = Buffer.from(candidate)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}
