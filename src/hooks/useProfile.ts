'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { Profile } from '@/types'

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [email, setEmail] = useState('')
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
    setEmail(user.email ?? '')
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(data as Profile | null)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function update(fields: Partial<Pick<Profile, 'full_name' | 'bio' | 'city'>>) {
    if (!profile) return 'Not signed in.'
    const supabase = createClient()
    const { error } = await supabase.from('profiles').update(fields).eq('id', profile.id)
    if (error) return error.message
    await reload()
    return null
  }

  async function uploadAvatar(file: File) {
    if (!profile) return 'Not signed in.'
    const supabase = createClient()
    const path = `${profile.id}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
      upsert: true,
    })
    if (uploadError) return uploadError.message
    const {
      data: { publicUrl },
    } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', profile.id)
    if (error) return error.message
    await reload()
    return null
  }

  return { profile, email, loading, update, uploadAvatar }
}
