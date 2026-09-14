import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayoutsOwed } from '@/lib/admin-reports'
import { PayoutAccountReviewActions } from '@/components/admin/PayoutAccountReviewActions'
import { PrepareStatementButton } from '@/components/admin/PrepareStatementButton'
import { DraftStatementActions } from '@/components/admin/DraftStatementActions'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

/**
 * Today in Asia/Manila as YYYY-MM-DD. The issue RPC compares the transfer date
 * against the Manila date, so the date input's `max` has to agree or the admin
 * gets a server refusal for a date the form let them pick.
 */
function manilaDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d)
}

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

interface ItemRow {
  booking_id: string
  amount: number
  booking_ref: string
  listing_title: string
  pickup_date: string
  return_date: string
}

interface StatementRow {
  id: string
  host_id: string
  amount: number
  status: 'pending' | 'paid' | 'failed'
  reference: string | null
  notes: string | null
  requested_at: string
  processed_at: string | null
  statement_number: string | null
  account_method: string | null
  account_name: string | null
  account_number: string | null
  transferred_on: string | null
  reversed_at: string | null
  reversal_reason: string | null
  statement_emailed_at: string | null
  profiles: { full_name: string } | null
  payout_items: ItemRow[]
}

export default async function AdminPayoutsPage() {
  const admin = createAdminClient()
  const STATEMENT_COLUMNS = `id, host_id, amount, status, reference, notes, requested_at, processed_at,
         statement_number, account_method, account_name, account_number, transferred_on,
         reversed_at, reversal_reason, statement_emailed_at,
         profiles!payout_requests_host_id_fkey(full_name),
         payout_items(booking_id, amount, booking_ref, listing_title, pickup_date, return_date)`
  const [{ data: accountsData }, { data: draftData }, { data: statementData }, owed] = await Promise.all([
    admin
      .from('payout_accounts')
      .select(
        'id, user_id, method, account_number, account_name, status, created_at, profiles!payout_accounts_user_id_fkey(full_name)'
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    // Drafts are queried on their own with NO limit: at most one per host (the
    // one-pending-per-host index), and every one blocks that host's next
    // draft — so a draft must never fall off this page behind a row limit.
    admin
      .from('payout_requests')
      .select(STATEMENT_COLUMNS)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    // "Issued" is defined by the NUMBER, not by the status: a reversed statement
    // is `failed` but keeps its number and must still appear. A cancelled draft
    // has no number and was never shown to the host, so it belongs in neither
    // list. Most recent 50.
    admin
      .from('payout_requests')
      .select(STATEMENT_COLUMNS)
      .not('statement_number', 'is', null)
      .order('requested_at', { ascending: false })
      .limit(50),
    getPayoutsOwed(),
  ])
  const accounts = (accountsData ?? []) as unknown as AccountRow[]
  const drafts = (draftData ?? []) as unknown as StatementRow[]
  const issued = (statementData ?? []) as unknown as StatementRow[]
  const statements = [...drafts, ...issued]

  const hostIds = Array.from(
    new Set([...accounts.map((a) => a.user_id), ...statements.map((r) => r.host_id)])
  )
  const suspendedHostIds = new Set<string>()
  if (hostIds.length > 0) {
    const { data: suspendedProfiles } = await admin
      .from('profiles')
      .select('id')
      .in('id', hostIds)
      .not('suspended_at', 'is', null)
    for (const p of suspendedProfiles ?? []) suspendedHostIds.add(p.id as string)
  }

  // A draft SNAPSHOTS the payout account it was prepared against, and
  // set_payout_account rewrites that row in place (048) — so a host can change
  // where their money should go after a draft exists. Compare, and say so.
  // Issuing is NOT blocked on a mismatch: if the admin already sent the money,
  // refusing to record a real transfer is worse than recording it.
  const currentAccounts = new Map<string, { method: string; account_name: string; account_number: string }>()
  if (drafts.length > 0) {
    const { data: current } = await admin
      .from('payout_accounts')
      .select('user_id, method, account_name, account_number')
      .in(
        'user_id',
        drafts.map((d) => d.host_id)
      )
    for (const a of current ?? []) {
      currentAccounts.set(a.user_id as string, {
        method: a.method as string,
        account_name: a.account_name as string,
        account_number: a.account_number as string,
      })
    }
  }
  function accountChanged(draft: StatementRow): boolean {
    const now = currentAccounts.get(draft.host_id)
    if (!now) return false // the account row is gone; nothing to compare against
    return (
      now.method !== draft.account_method ||
      now.account_name !== draft.account_name ||
      now.account_number !== draft.account_number
    )
  }

  const today = manilaDate(new Date())

  return (
    <div className="space-y-10">
      {/* ── 1. Payout accounts awaiting review ── */}
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

      {/* ── 2. Owed to hosts ── */}
      <section>
        <h2 className="mb-1 text-2xl font-bold text-gray-900">Owed to Hosts</h2>
        <p className="mb-4 text-xs text-gray-500">
          Completed, paid bookings no statement has claimed — from{' '}
          <code>payouts_owed()</code>, the same rule a draft itemizes with. Hosts don&apos;t request
          payouts; preparing a statement is how one starts. Blocker says what would stop it.
        </p>
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          {owed.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">Nothing is owed to any host right now.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Bookings</th>
                  <th className="px-4 py-3">Owed</th>
                  <th className="px-4 py-3">Blocker</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {owed.map((h) => (
                  <tr key={h.hostId} className="border-b border-gray-50 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {h.hostName}
                        {suspendedHostIds.has(h.hostId) && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                            Suspended
                          </span>
                        )}
                      </p>
                      {h.sublabel && <p className="text-xs text-gray-500">{h.sublabel}</p>}
                    </td>
                    <td className="px-4 py-3">{h.bookings}</td>
                    <td className="px-4 py-3 font-semibold">{peso(h.amount)}</td>
                    <td className="px-4 py-3">
                      {h.blocker ? (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                          {h.blocker}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {h.blocker === null && (
                        <PrepareStatementButton
                          hostId={h.hostId}
                          hostName={h.hostName}
                          amount={h.amount}
                          amountLabel={peso(h.amount)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── 3. Drafts ── */}
      <section>
        <h2 className="mb-1 text-2xl font-bold text-gray-900">Drafts</h2>
        <p className="mb-4 text-xs text-gray-500">
          Prepared but not transferred. Send the money to the account details shown here — they are the
          snapshot the statement will say it was paid to — then record the transfer.
        </p>
        {drafts.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No draft statements.
          </p>
        )}
        <div className="space-y-4">
          {drafts.map((d) => (
            <div key={d.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {d.profiles?.full_name || 'Unknown host'}
                    {suspendedHostIds.has(d.host_id) && (
                      <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                        Suspended — verify before paying
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600">
                    {d.account_method ?? '—'} · {d.account_name ?? '—'} · {d.account_number ?? '—'}
                  </p>
                  <p className="text-xs text-gray-400">
                    Prepared {new Date(d.requested_at).toLocaleDateString('en-PH')}
                  </p>
                </div>
                <p className="text-2xl font-bold text-[#003049]">{peso(d.amount)}</p>
              </div>

              {accountChanged(d) && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Account changed since this draft — cancel and re-prepare unless you already sent it.
                </p>
              )}

              <details className="mt-3 text-sm text-gray-600">
                <summary className="cursor-pointer text-xs font-semibold text-gray-500">
                  {d.payout_items.length} booking{d.payout_items.length === 1 ? '' : 's'} covered
                </summary>
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="py-1 pr-3 font-semibold">Booking</th>
                      <th className="py-1 pr-3 font-semibold">Dates</th>
                      <th className="py-1 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.payout_items.map((i) => (
                      <tr key={i.booking_id}>
                        <td className="py-1 pr-3">
                          <span className="font-mono">{i.booking_ref}</span>
                          <span className="ml-2 text-gray-500">{i.listing_title}</span>
                        </td>
                        <td className="py-1 pr-3 whitespace-nowrap text-gray-500">
                          {i.pickup_date} – {i.return_date}
                        </td>
                        <td className="py-1 text-right font-semibold">{peso(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <DraftStatementActions
                requestId={d.id}
                amountLabel={peso(d.amount)}
                todayManila={today}
                minDate={manilaDate(d.requested_at)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. Issued ── */}
      <section>
        <h2 className="mb-4 text-xl font-bold text-gray-900">Issued Statements</h2>
        {issued.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No statements issued yet.
          </p>
        )}
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          {issued.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-4 py-3">Statement</th>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Transferred</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Emailed</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/payouts/${r.id}`}
                        className="font-mono font-semibold text-[#003049] hover:underline"
                      >
                        {r.statement_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.profiles?.full_name || '—'}
                      {suspendedHostIds.has(r.host_id) && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                          Suspended
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">{peso(r.amount)}</td>
                    <td className="px-4 py-3 text-xs">{r.transferred_on ?? '—'}</td>
                    <td className="px-4 py-3 text-xs break-all">{r.reference ?? '—'}</td>
                    <td className="px-4 py-3">
                      {r.reversed_at ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                          Reversed
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                          Paid
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.statement_emailed_at ? (
                        new Date(r.statement_emailed_at).toLocaleDateString('en-PH')
                      ) : (
                        <Link href={`/admin/payouts/${r.id}`} className="font-semibold text-amber-700 hover:underline">
                          Email not sent — Resend
                        </Link>
                      )}
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
