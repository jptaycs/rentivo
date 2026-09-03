import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function pendingCount(table: string) {
  const admin = createAdminClient()
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  return count ?? 0
}

// `profiles` has no `status` column, so this can't reuse pendingCount above.
// Also excludes soft-deleted auth users (deleteUser(uid, true) keeps the
// auth.users row with deleted_at set) — otherwise tombstones would inflate
// both counts, same reasoning as the /admin/users list page.
async function userCounts() {
  const admin = createAdminClient()
  const [{ data: usersList }, { data: profilesData }] = await Promise.all([
    // NOTE: perPage caps this at 1000 auth users — fine at this app's current
    // scale, will need real pagination before it isn't (same note as the
    // /admin/users list page).
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('profiles').select('id, suspended_at').limit(1000),
  ])
  const deletedIds = new Set((usersList?.users ?? []).filter((u) => u.deleted_at).map((u) => u.id))
  const visible = (profilesData ?? []).filter((p) => !deletedIds.has(p.id))
  return {
    total: visible.length,
    suspended: visible.filter((p) => p.suspended_at !== null).length,
  }
}

// `host_bills` has no `pending` status (pendingCount above only fits a
// `status = 'pending'` filter), so this gets its own helper: issued bills
// past their due date, mirroring isOverdue()'s definition server-side.
async function overdueBillsCount() {
  const admin = createAdminClient()
  const { count } = await admin
    .from('host_bills')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'issued')
    .lt('due_at', new Date().toISOString())
  return count ?? 0
}

export default async function AdminOverviewPage() {
  const [verifications, payoutAccounts, payoutRequests, users, overdueBills] = await Promise.all([
    pendingCount('verification_requests'),
    pendingCount('payout_accounts'),
    pendingCount('payout_requests'),
    userCounts(),
    overdueBillsCount(),
  ])

  const cards = [
    { label: 'Pending identity verifications', count: verifications, href: '/admin/verifications' },
    { label: 'Payout accounts awaiting review', count: payoutAccounts, href: '/admin/payouts' },
    { label: 'Pending payout requests', count: payoutRequests, href: '/admin/payouts' },
    { label: 'Overdue commission bills', count: overdueBills, href: '/admin/bills?status=overdue' },
    { label: 'Total users', count: users.total, href: '/admin/users' },
    { label: 'Suspended users', count: users.suspended, href: '/admin/users?status=suspended' },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-3xl font-bold text-[#003049]">{c.count}</p>
            <p className="mt-1 text-sm text-gray-500">{c.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
