import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isAdminEmail } from '@/lib/admin-emails'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — do not remove this
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isProtected = PROTECTED_PREFIXES.some(
    p => path === p || path.startsWith(`${p}/`)
  )
  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  // A ban blocks new logins, but an already-issued JWT stays valid for up to an
  // hour. Close that window on the routes that matter. Deliberately scoped to
  // PROTECTED_PREFIXES: those pages already hit the database, so this read costs
  // nothing there, while public browsing — the overwhelming majority of
  // requests — stays query-free.
  if (user && isProtected) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('suspended_at')
      .eq('id', user.id)
      .maybeSingle()
    if (profile?.suspended_at) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?suspended=1'
      const res = NextResponse.redirect(url)
      // Clear the session so the next request is a clean signed-out state rather
      // than looping through this same check.
      for (const c of request.cookies.getAll()) {
        if (c.name.includes('-auth-token')) res.cookies.delete(c.name)
      }
      return res
    }
  }

  // /admin is allowlist-only. Convenience layer — requireAdminPage()/
  // requireAdminApi() re-check server-side; this is never the sole gate.
  const isAdminPagePath = path === '/admin' || path.startsWith('/admin/')
  if (isAdminPagePath && user && !isAdminEmail(user.email)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // /api/admin/* has no login-redirect fallback (unlike the page paths
  // above, via PROTECTED_PREFIXES) and every route here is POST-only —
  // without this check, a GET (or any non-POST verb) to one of these
  // routes would reach Next's own router and get a 405, which (unlike a
  // real 404) confirms the route exists to an unauthenticated prober.
  // Gate on any non-admin-authenticated state directly, before Next's
  // router can distinguish "wrong method" from "doesn't exist."
  const isAdminApiPath = path.startsWith('/api/admin/')
  if (isAdminApiPath && (!user || !isAdminEmail(user.email))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  return supabaseResponse
}

const PROTECTED_PREFIXES = ['/dashboard', '/host', '/book', '/messages', '/admin']
