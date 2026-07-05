'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export interface SessionUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

// Shown while Supabase env vars are absent so the mock-data UI keeps working
const MOCK_USER: SessionUser = {
  id: 'mock-user',
  email: 'jptayco1109@gmail.com',
  name: 'Juan P. Tayco',
  avatarUrl: null,
}

function toSessionUser(user: User): SessionUser {
  const meta = user.user_metadata ?? {}
  const email = user.email ?? ''
  return {
    id: user.id,
    email,
    name: meta.full_name ?? meta.name ?? email.split('@')[0] ?? 'User',
    avatarUrl: meta.avatar_url ?? null,
  }
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('')
}

export function useUser() {
  const router = useRouter()
  const configured = isSupabaseConfigured()
  const [user, setUser] = useState<SessionUser | null>(configured ? null : MOCK_USER)
  const [loading, setLoading] = useState(configured)

  useEffect(() => {
    if (!configured) return
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? toSessionUser(data.user) : null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? toSessionUser(session.user) : null)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [configured])

  async function signOut() {
    if (configured) {
      await createClient().auth.signOut()
    }
    router.push('/')
    router.refresh()
  }

  return { user, loading, configured, signOut }
}
