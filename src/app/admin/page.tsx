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

export default async function AdminOverviewPage() {
  const [verifications, payoutAccounts, payoutRequests] = await Promise.all([
    pendingCount('verification_requests'),
    pendingCount('payout_accounts'),
    pendingCount('payout_requests'),
  ])

  const cards = [
    { label: 'Pending identity verifications', count: verifications, href: '/admin/verifications' },
    { label: 'Payout accounts awaiting review', count: payoutAccounts, href: '/admin/payouts' },
    { label: 'Pending payout requests', count: payoutRequests, href: '/admin/payouts' },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-3">
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
