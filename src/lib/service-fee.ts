import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { DEFAULT_SERVICE_FEE_BPS } from '@/lib/pricing'

/**
 * The platform service-fee rate in basis points, for server components.
 *
 * Falls back to DEFAULT_SERVICE_FEE_BPS and logs on any failure rather than
 * throwing the page into an error boundary: the number shown before payment is
 * a DISPLAY. create_booking computes the real fee server-side, and the checkout
 * route's 409 `total_changed` is what stops a mismatched charge — a listing
 * page that 500s because one RPC hiccuped would be a far worse outcome than a
 * stale percentage on a label.
 */
export async function getServiceFeeBps(): Promise<number> {
  if (!isSupabaseConfigured()) return DEFAULT_SERVICE_FEE_BPS
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('current_service_fee_bps')
    if (error || typeof data !== 'number') {
      console.error('[service-fee] rate read failed, using the default', error)
      return DEFAULT_SERVICE_FEE_BPS
    }
    return data
  } catch (err) {
    console.error('[service-fee] rate read threw, using the default', err)
    return DEFAULT_SERVICE_FEE_BPS
  }
}
