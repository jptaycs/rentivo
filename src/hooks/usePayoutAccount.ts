'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { PayoutAccount } from '@/types'

export function usePayoutAccount() {
  const [account, setAccountState] = useState<PayoutAccount | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setAccountState(null)
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAccountState(null)
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('payout_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!error) setAccountState(data as PayoutAccount | null)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  async function setPayoutAccount(input: { method: PayoutAccount['method']; accountNumber: string; accountName: string }) {
    const supabase = createClient()
    const { error } = await supabase.rpc('set_payout_account', {
      p_method: input.method,
      p_account_number: input.accountNumber,
      p_account_name: input.accountName,
    })
    if (error) return error.message
    await reload()
    return null
  }

  return { account, loading, setPayoutAccount, reload }
}
