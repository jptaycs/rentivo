import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatFeeRate } from '@/lib/pricing'

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

/**
 * The service fee is a rate, not a count, so it renders as a formatted string.
 * A missing settings row is shown as "—" rather than a guessed percentage —
 * create_booking raises in that state (080), so a number here would be a lie.
 */
async function serviceFeeLabel() {
  const admin = createAdminClient()
  const { data } = await admin
    .from('platform_settings')
    .select('service_fee_bps')
    .eq('id', true)
    .maybeSingle()
  return typeof data?.service_fee_bps === 'number' ? formatFeeRate(data.service_fee_bps) : '—'
}

export default async function AdminOverviewPage() {
  const [verifications, payoutAccounts, payoutRequests, users, serviceFee] = await Promise.all([
    pendingCount('verification_requests'),
    pendingCount('payout_accounts'),
    pendingCount('payout_requests'),
    userCounts(),
    serviceFeeLabel(),
  ])

  // `value` is a string, not a number: the service-fee card shows a rate and the
  // rest show counts, and one shape for both beats special-casing a card.
  const cards = [
    { label: 'Pending identity verifications', value: String(verifications), href: '/admin/verifications' },
    { label: 'Payout accounts awaiting review', value: String(payoutAccounts), href: '/admin/payouts' },
    { label: 'Pending payout requests', value: String(payoutRequests), href: '/admin/payouts' },
    { label: 'Total users', value: String(users.total), href: '/admin/users' },
    { label: 'Suspended users', value: String(users.suspended), href: '/admin/users?status=suspended' },
    { label: 'Service fee', value: serviceFee, href: '/admin/settings' },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-3xl font-bold text-[#003049]">{c.value}</p>
            <p className="mt-1 text-sm text-gray-500">{c.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
