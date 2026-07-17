import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client for privileged server-side writes
 * (payment confirmation from webhooks / redirect verification).
 * Bypasses RLS — never expose to the browser.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secretKey) {
    throw new Error(
      'SUPABASE_SECRET_KEY is not configured — payments need it to confirm bookings server-side.'
    )
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
