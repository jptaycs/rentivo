'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { VerificationRequest } from '@/types'

export function useVerification() {
  const [request, setRequest] = useState<VerificationRequest | null>(null)
  const [isVerified, setIsVerified] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const [{ data: profile }, { data: latest }] = await Promise.all([
      supabase.from('profiles').select('is_verified').eq('id', user.id).single(),
      supabase
        .from('verification_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    setIsVerified(profile?.is_verified ?? false)
    setRequest(latest as VerificationRequest | null)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  async function submit(
    idFile: File,
    selfieFile: File,
    autoCheck?: { failed: boolean; detail: string | null }
  ): Promise<string | null> {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return 'You must be signed in.'

    const idExt = idFile.name.split('.').pop()?.toLowerCase() || 'jpg'
    const selfieExt = selfieFile.name.split('.').pop()?.toLowerCase() || 'jpg'
    const idPath = `${user.id}/id-${Date.now()}.${idExt}`
    const selfiePath = `${user.id}/selfie-${Date.now()}.${selfieExt}`

    const { error: idError } = await supabase.storage
      .from('verification-docs')
      .upload(idPath, idFile, { contentType: idFile.type })
    if (idError) return `ID upload failed: ${idError.message}`

    const { error: selfieError } = await supabase.storage
      .from('verification-docs')
      .upload(selfiePath, selfieFile, { contentType: selfieFile.type })
    if (selfieError) return `Selfie upload failed: ${selfieError.message}`

    const { error: insertError } = await supabase.from('verification_requests').insert({
      user_id: user.id,
      id_doc_path: idPath,
      selfie_path: selfiePath,
      auto_check_failed: autoCheck?.failed ?? false,
      auto_check_detail: autoCheck?.detail ?? null,
    })
    if (insertError) return insertError.message

    await reload()
    return null
  }

  return { request, isVerified, loading, submit, reload }
}
