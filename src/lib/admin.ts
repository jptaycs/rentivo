import 'server-only'
import { notFound } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin-emails'

/** Pages/layouts: returns the admin user, or renders the 404 page. */
export async function requireAdminPage(): Promise<User> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) notFound()
  return user!
}

/**
 * API routes: returns the admin user, or a 404 JSON response the caller
 * must return as-is (404, not 403 — the panel isn't advertised).
 */
export async function requireAdminApi(): Promise<User | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return user
}
