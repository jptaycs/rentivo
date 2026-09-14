'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { DEFAULT_SERVICE_FEE_BPS } from '@/lib/pricing'

/**
 * The platform service-fee rate for client components.
 *
 * `bps: null` after loading means the read FAILED. Host-facing copy must then
 * hide the percentage rather than print a guess — a host reading "5%" when the
 * rate is 7% is worse than a host reading a sentence with no number in it. (The
 * renter-facing side takes the opposite trade, in getServiceFeeBps: there the
 * number is a display and the 409 is the backstop.)
 */
export function useServiceFeeBps(): { bps: number | null; loading: boolean } {
  const [state, setState] = useState<{ bps: number | null; loading: boolean }>({
    bps: isSupabaseConfigured() ? null : DEFAULT_SERVICE_FEE_BPS,
    loading: isSupabaseConfigured(),
  })

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let cancelled = false
    createClient()
      .rpc('current_service_fee_bps')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || typeof data !== 'number') {
          console.error('[service-fee] rate read failed', error)
          setState({ bps: null, loading: false })
        } else {
          setState({ bps: data, loading: false })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
