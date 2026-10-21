import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Anon-key client with NO cookie session, for public reads outside a request
 * (sitemap generation, metadata). RLS applies exactly as it does for a
 * signed-out visitor, so this can only ever see what the public storefront
 * sees. Never used for writes.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
