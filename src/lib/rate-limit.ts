import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * App-level rate limits, enforced in Postgres by `rate_limit_consume` (076) —
 * no Redis/Upstash. The function is service_role-only, so this always goes
 * through the admin client. Keys are `<route>:<user id>`; account deletion
 * purges them (`key like '%:<uid>'`), so keep the user id LAST in any new key.
 *
 * Window lengths must stay <= 24h (the function refuses longer ones — its
 * global prune drops day-old rows).
 */
export const RATE_LIMITS = {
  // Every call can create a PayMongo payment intent.
  checkout: { max: 10, windowSeconds: 600 },
  // On top of the once-per-message notified_at claim.
  notify: { max: 60, windowSeconds: 600 },
  respond: { max: 30, windowSeconds: 600 },
  verifyPayment: { max: 30, windowSeconds: 600 },
  accountDelete: { max: 5, windowSeconds: 3600 },
} as const

export type RateLimitName = keyof typeof RATE_LIMITS

const PREFIX: Record<RateLimitName, string> = {
  checkout: 'checkout',
  notify: 'notify',
  respond: 'respond',
  verifyPayment: 'verify-payment',
  accountDelete: 'account-delete',
}

/**
 * Consume one hit. Returns a ready 429 response when over the limit, or null
 * when the request may proceed.
 *
 * FAILS OPEN on a limiter error (logged): a database hiccup in the limiter
 * must not block every checkout in production. The database-level triggers
 * (bookings 10/h per renter, messages 30/min per sender) still guard the
 * inserts behind these routes, and the notify route's notified_at claim still
 * caps its email at one per message.
 */
export async function rateLimit(name: RateLimitName, userId: string): Promise<NextResponse | null> {
  const { max, windowSeconds } = RATE_LIMITS[name]
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rate_limit_consume', {
      p_key: `${PREFIX[name]}:${userId}`,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error(`[rate-limit] ${name} limiter error — failing open`, error.message)
      return null
    }
    if (data === false) {
      const minutes = Math.ceil(windowSeconds / 60)
      const wait = minutes >= 60 ? 'an hour' : `${minutes} minutes`
      return NextResponse.json(
        { error: `Too many attempts. Please wait up to ${wait} and try again.` },
        { status: 429, headers: { 'Retry-After': String(windowSeconds) } }
      )
    }
    return null
  } catch (e) {
    console.error(`[rate-limit] ${name} limiter threw — failing open`, e)
    return null
  }
}
