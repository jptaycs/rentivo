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

  // /admin is allowlist-only. Convenience layer — requireAdminPage()/
  // requireAdminApi() re-check server-side; this is never the sole gate.
  const isAdminPath = path === '/admin' || path.startsWith('/admin/')
  if (isAdminPath && user && !isAdminEmail(user.email)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  return supabaseResponse
}

const PROTECTED_PREFIXES = ['/dashboard', '/host', '/book', '/messages', '/admin']
