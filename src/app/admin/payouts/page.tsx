import { createAdminClient } from '@/lib/supabase/admin'
import { PayoutAccountReviewActions } from '@/components/admin/PayoutAccountReviewActions'
import { PayoutRequestActions } from '@/components/admin/PayoutRequestActions'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

interface AccountRow {
  id: string
  user_id: string
  method: string
  account_number: string
  account_name: string
  status: string
  created_at: string
  profiles: { full_name: string } | null
}

interface RequestRow {
  id: string
  host_id: string
  amount: number
  status: 'pending' | 'paid' | 'failed'
  reference: string | null
  notes: string | null
  requested_at: string
  processed_at: string | null
  profiles: { full_name: string } | null
  payout_accounts: { method: string; account_number: string; account_name: string } | null
  payout_items: { booking_id: string; amount: number }[]
}

export default async function AdminPayoutsPage() {
  const admin = createAdminClient()
  const [{ data: accountsData }, { data: requestsData }] = await Promise.all([
    admin
      .from('payout_accounts')
      .select(
        'id, user_id, method, account_number, account_name, status, created_at, profiles!payout_accounts_user_id_fkey(full_name)'
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    admin
      .from('payout_requests')
      .select(
        'id, host_id, amount, status, reference, notes, requested_at, processed_at, profiles!payout_requests_host_id_fkey(full_name), payout_accounts!payout_requests_payout_account_id_fkey(method, account_number, account_name), payout_items(booking_id, amount)'
      )
      .order('requested_at', { ascending: false })
      .limit(50),
  ])
  const accounts = (accountsData ?? []) as unknown as AccountRow[]
  const requests = (requestsData ?? []) as unknown as RequestRow[]
  const pending = requests.filter((r) => r.status === 'pending')
  const settled = requests.filter((r) => r.status !== 'pending')

  // A payout request already `pending` when a host is suspended is NOT
  // unwound (see AGENTS.md task-8 brief correction) — it can still be marked
  // paid from here. Surface suspension so an admin doesn't pay a suspended
  // host by accident, rather than silently blocking the action.
  const hostIds = Array.from(new Set([...accounts.map((a) => a.user_id), ...requests.map((r) => r.host_id)]))
  const suspendedHostIds = new Set<string>()
  if (hostIds.length > 0) {
    const { data: suspendedProfiles } = await admin
      .from('profiles')
      .select('id')
      .in('id', hostIds)
      .not('suspended_at', 'is', null)
    for (const p of suspendedProfiles ?? []) suspendedHostIds.add(p.id as string)
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-4 text-2xl font-bold text-gray-900">Payout Accounts Awaiting Review</h1>
        {accounts.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No payout accounts awaiting review.
          </p>
        )}
        <div className="space-y-4">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="font-semibold text-gray-900">
                {a.profiles?.full_name || 'Unknown host'}
                {suspendedHostIds.has(a.user_id) && (
                  <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                    Suspended
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {a.method} · {a.account_name} · {a.account_number}
              </p>
              <p className="text-xs text-gray-400">
                Submitted {new Date(a.created_at).toLocaleDateString('en-PH')}
              </p>
              <PayoutAccountReviewActions accountId={a.id} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Pending Payout Requests</h2>
        {pending.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No pending payout requests.
          </p>
        )}
        <div className="space-y-4">
          {pending.map((r) => (
            <div key={r.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {r.profiles?.full_name || 'Unknown host'}
                    {suspendedHostIds.has(r.host_id) && (
                      <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                        Suspended — verify before paying
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600">
                    {r.payout_accounts
                      ? `${r.payout_accounts.method} · ${r.payout_accounts.account_name} · ${r.payout_accounts.account_number}`
                      : 'Account unavailable'}
                  </p>
                  <p className="text-xs text-gray-400">
                    Requested {new Date(r.requested_at).toLocaleDateString('en-PH')}
                  </p>
                </div>
                <p className="text-2xl font-bold text-[#003049]">{peso(r.amount)}</p>
              </div>
              <details className="mt-3 text-sm text-gray-600">
                <summary className="cursor-pointer text-xs font-semibold text-gray-500">
                  {r.payout_items.length} booking{r.payout_items.length === 1 ? '' : 's'} covered
                </summary>
                <ul className="mt-2 space-y-1">
                  {r.payout_items.map((i) => (
                    <li key={i.booking_id} className="font-mono text-xs">
                      {i.booking_id} — {peso(i.amount)}
                    </li>
                  ))}
                </ul>
              </details>
              <PayoutRequestActions requestId={r.id} amount={peso(r.amount)} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold text-gray-900">History</h2>
        {settled.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No settled payout requests yet.
          </p>
        )}
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          {settled.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reference / Reason</th>
                  <th className="px-4 py-3">Processed</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      {r.profiles?.full_name || '—'}
                      {suspendedHostIds.has(r.host_id) && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                          Suspended
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">{peso(r.amount)}</td>
                    <td className="px-4 py-3 capitalize">{r.status}</td>
                    <td className="px-4 py-3 text-xs">{r.reference || r.notes || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.processed_at ? new Date(r.processed_at).toLocaleDateString('en-PH') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
