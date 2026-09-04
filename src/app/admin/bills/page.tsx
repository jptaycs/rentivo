import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPage } from '@/lib/admin'
import { periodLabel, isOverdue, previousPeriod } from '@/lib/billing'
import { BillRunForm } from '@/components/admin/BillRunForm'
import { BillVoidAction } from '@/components/admin/BillVoidAction'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

type Status = 'issued' | 'overdue' | 'paid' | 'void' | 'all'
interface Row {
  id: string; host_id: string; period: string; amount: number; status: 'issued' | 'paid' | 'void'
  issued_at: string; due_at: string; paid_at: string | null; paymongo_ref: string | null; void_reason: string | null
  profiles: { full_name: string } | null
  host_bill_items: { id: string }[]
}

export default async function AdminBillsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage()
  const { status: raw } = await searchParams
  const status: Status = (['issued', 'overdue', 'paid', 'void', 'all'] as Status[]).includes(raw as Status) ? (raw as Status) : 'issued'

  const admin = createAdminClient()
  let q = admin
    .from('host_bills')
    .select('id, host_id, period, amount, status, issued_at, due_at, paid_at, paymongo_ref, void_reason, profiles!host_bills_host_id_fkey(full_name), host_bill_items(id)')
    .order('issued_at', { ascending: false })
    .limit(500)
  if (status === 'issued') q = q.eq('status', 'issued')
  // Pushed into the query rather than filtered in JS after fetching 500
  // `issued` rows: past 500 issued bills, a JS filter could silently drop
  // overdue rows the /admin overview card's own exact-count query still
  // sees, making this list and that count disagree.
  else if (status === 'overdue') q = q.eq('status', 'issued').lt('due_at', new Date().toISOString())
  else if (status !== 'all') q = q.eq('status', status)
  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  const tabs: Status[] = ['issued', 'overdue', 'paid', 'void', 'all']
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Commission Bills</h1>
        <p className="text-sm text-gray-500">5% service fee on host-QR bookings, billed monthly. The cron runs on the 1st; use Run billing for a missed month or after a void. Rerunning a month never duplicates.</p>
        <p className="text-sm text-gray-500">Void without Waive corrects a mistaken bill — rerun the period to re-bill it. Void with Waive is for a bill the host already settled outside the app.</p>
      </div>
      <BillRunForm defaultPeriod={previousPeriod().slice(0, 7)} />
      <div className="flex gap-2 text-sm">
        {tabs.map((t) => (
          <Link key={t} href={`/admin/bills?status=${t}`} className={`rounded-full px-3 py-1 ${status === t ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 shadow-sm'}`}>{t}</Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No {status === 'all' ? '' : status + ' '}bills.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="px-4 py-3">Host</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Bookings</th><th className="px-4 py-3">Issued</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">PayMongo ref</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 align-top">
                  <td className="px-4 py-3"><Link href={`/admin/users/${r.host_id}`} className="font-medium text-[#003049] hover:underline">{r.profiles?.full_name ?? 'Unknown host'}</Link></td>
                  <td className="px-4 py-3">{periodLabel(r.period)}</td>
                  <td className="px-4 py-3 font-semibold">{peso(r.amount)}</td>
                  <td className="px-4 py-3">{r.host_bill_items.length}</td>
                  <td className="px-4 py-3">{date(r.issued_at)}</td>
                  <td className="px-4 py-3">{date(r.due_at)}</td>
                  <td className="px-4 py-3">
                    {r.status === 'paid' ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Paid</span>
                      : r.status === 'void' ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600" title={r.void_reason ?? ''}>Void</span>
                      : isOverdue(r) ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>
                      : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Issued</span>}
                  </td>
                  <td className="px-4 py-3">{date(r.paid_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.paymongo_ref ?? '—'}</td>
                  <td className="px-4 py-3">{r.status === 'issued' && <BillVoidAction billId={r.id} amount={peso(r.amount)} hasPaymentAttempt={Boolean(r.paymongo_ref)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
