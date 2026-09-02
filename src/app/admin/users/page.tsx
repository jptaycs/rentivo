import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Explicit column list — never `select('*')` on profiles, even through the
// admin client (see AGENTS.md's street_address/qr_payment_label leaks). This
// is the admin view so it can legitimately go further than the public
// PROFILE_COLUMNS allowlist (e.g. suspended_at), but it still must be a
// deliberate list, not a wildcard.
const COLUMNS = 'id, full_name, avatar_url, city, is_host, is_verified, suspended_at, created_at'

interface ProfileRow {
  id: string
  full_name: string
  avatar_url: string | null
  city: string | null
  is_host: boolean
  is_verified: boolean
  suspended_at: string | null
  created_at: string
}

const ROLE_FILTERS = ['host', 'renter'] as const
const STATUS_FILTERS = ['suspended', 'active'] as const

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string }>
}) {
  const { q: rawQ, role: rawRole, status: rawStatus } = await searchParams
  const q = (rawQ ?? '').trim()
  const role = ROLE_FILTERS.includes(rawRole as (typeof ROLE_FILTERS)[number])
    ? (rawRole as (typeof ROLE_FILTERS)[number])
    : undefined
  const status = STATUS_FILTERS.includes(rawStatus as (typeof STATUS_FILTERS)[number])
    ? (rawStatus as (typeof STATUS_FILTERS)[number])
    : undefined

  const admin = createAdminClient()

  let query = admin.from('profiles').select(COLUMNS).order('created_at', { ascending: false }).limit(500)
  if (role === 'host') query = query.eq('is_host', true)
  if (role === 'renter') query = query.eq('is_host', false)
  if (status === 'suspended') query = query.not('suspended_at', 'is', null)
  if (status === 'active') query = query.is('suspended_at', null)
  const { data } = await query
  const profiles = (data ?? []) as ProfileRow[]

  // Email lives in auth.users, not profiles — resolve by joining in memory.
  // NOTE: perPage: 1000 caps this at 1000 auth users total. This app is well
  // under that today; real pagination (listUsers' page param, looped) will be
  // needed before it isn't.
  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailById = new Map<string, string>()
  const deletedIds = new Set<string>()
  for (const u of usersList?.users ?? []) {
    emailById.set(u.id, u.email ?? '—')
    // deleteUser(uid, true) soft-deletes: the auth.users row stays (with
    // deleted_at set) so profiles.id's FK never cascades, but that means a
    // tombstone would otherwise show up here as a live user. Filter it out.
    if (u.deleted_at) deletedIds.add(u.id)
  }

  let visible = profiles.filter((p) => !deletedIds.has(p.id))

  if (q) {
    const needle = q.toLowerCase()
    visible = visible.filter(
      (p) =>
        p.full_name.toLowerCase().includes(needle) ||
        (emailById.get(p.id) ?? '').toLowerCase().includes(needle)
    )
  }

  const filterHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    const next = { q: rawQ, role, status, ...patch }
    if (next.q) params.set('q', next.q)
    if (next.role) params.set('role', next.role)
    if (next.status) params.set('status', next.status)
    const qs = params.toString()
    return `/admin/users${qs ? `?${qs}` : ''}`
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Users</h1>

      <form className="mb-6 flex flex-wrap items-center gap-3" action="/admin/users">
        {role && <input type="hidden" name="role" value={role} />}
        {status && <input type="hidden" name="status" value={status} />}
        <input
          type="text"
          name="q"
          defaultValue={rawQ ?? ''}
          placeholder="Search name or email…"
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-[#003049] focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-[#003049] px-4 py-2 text-sm font-semibold text-white"
        >
          Search
        </button>

        <span className="mx-1 h-5 w-px bg-gray-200" />

        {(['host', 'renter'] as const).map((r) => (
          <Link
            key={r}
            href={filterHref({ role: role === r ? undefined : r })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
              role === r ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            {r}
          </Link>
        ))}

        <span className="mx-1 h-5 w-px bg-gray-200" />

        {(['active', 'suspended'] as const).map((s) => (
          <Link
            key={s}
            href={filterHref({ status: status === s ? undefined : s })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
              status === s ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            {s}
          </Link>
        ))}

        {(rawQ || role || status) && (
          <Link href="/admin/users" className="text-xs text-gray-500 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      {visible.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          No users match these filters.
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Verified</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${p.id}`} className="font-semibold text-[#003049] hover:underline">
                      {p.full_name || 'Unnamed user'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{emailById.get(p.id) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        p.is_host ? 'bg-blue-50 text-[#003049]' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {p.is_host ? 'Host' : 'Renter'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.is_verified ? (
                      <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                        Verified
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.suspended_at ? (
                      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
                        Suspended
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.city || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(p.created_at).toLocaleDateString('en-PH')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
