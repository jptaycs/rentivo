/**
 * Which PayMongo-processed checkout methods are switched off right now.
 *
 * Client-safe (no server-only imports) so Step3Payment and the checkout
 * route read the same list. NEXT_PUBLIC_* is inlined at build time, so
 * changing the value needs a rebuild + redeploy, not just an env edit.
 *
 * Why this exists: gcash/maya/card are pending PayMongo's KYB approval and
 * are rejected by PayMongo on a live attach. The client hides those tiles,
 * but a crafted or stale request could still name one, so the checkout route
 * checks here too — before any booking row is created — and answers with a
 * specific message rather than PayMongo's generic failure.
 */

export type ChargeableMethod = 'gcash' | 'maya' | 'card' | 'qrph'

export const CHARGEABLE_METHODS: readonly ChargeableMethod[] = ['gcash', 'maya', 'card', 'qrph']

export const PAYMENT_METHOD_LABELS: Record<ChargeableMethod, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Credit / Debit Card',
  qrph: 'QR Ph',
}

export const DISABLED_PAYMENT_METHODS: readonly string[] = (
  process.env.NEXT_PUBLIC_DISABLED_PAYMENT_METHODS ?? ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export function isPaymentMethodDisabled(method: string): boolean {
  return DISABLED_PAYMENT_METHODS.includes(method)
}

/** Chargeable methods that are not disabled, in display order. */
export function enabledPaymentMethods(): ChargeableMethod[] {
  return CHARGEABLE_METHODS.filter((m) => !isPaymentMethodDisabled(m))
}

/**
 * Renter-facing copy for a method PayMongo won't accept yet — names the
 * method and says what to use instead, rather than "Payment failed".
 */
export function unavailableMethodMessage(method: string): string {
  const label = PAYMENT_METHOD_LABELS[method as ChargeableMethod] ?? 'That payment method'
  const alternatives = enabledPaymentMethods().map((m) => PAYMENT_METHOD_LABELS[m])
  const hint =
    alternatives.length === 0
      ? 'Please try again later.'
      : alternatives.length === 1
        ? `Please pay with ${alternatives[0]} instead.`
        : `Please pay with ${alternatives.slice(0, -1).join(', ')} or ${alternatives.at(-1)} instead.`
  return `${label} isn't available on Rentivo yet. ${hint}`
}
