import { requireAdminPage } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatFeeRate } from '@/lib/pricing'
import { ServiceFeeForm } from '@/components/admin/ServiceFeeForm'

export const dynamic = 'force-dynamic'

/** admin_actions.detail is jsonb, so nothing guarantees the shape at read time. */
interface RateChangeDetail {
  previous_bps?: unknown
  service_fee_bps?: unknown
  reason?: unknown
}

interface RateChangeRow {
  id: string
  admin_email: string
  created_at: string
  detail: RateChangeDetail | null
}

/** Render a stored bps figure, or an em dash if the row doesn't carry one. */
function rate(value: unknown): string {
  return typeof value === 'number' ? formatFeeRate(value) : '—'
}

export default async function AdminSettingsPage() {
  // Defense in depth: the layout gates too, but this page shows and changes the
  // platform's pricing, so it does not rely on a parent call alone.
  await requireAdminPage()

  const admin = createAdminClient()

  // platform_settings is revoked from anon/authenticated entirely (080) — the
  // service-role client is the only thing that can read the row directly.
  const [{ data: settings }, { data: history }] = await Promise.all([
    admin.from('platform_settings').select('service_fee_bps, updated_at').eq('id', true).maybeSingle(),
    admin
      .from('admin_actions')
      .select('id, admin_email, created_at, detail')
      .eq('action', 'service_fee_rate_change')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const rows = (history ?? []) as RateChangeRow[]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Settings</h1>

      <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Platform service fee</p>
        {settings ? (
          <>
            <p className="mt-1 text-3xl font-bold text-[#003049]">
              {formatFeeRate(settings.service_fee_bps)}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Charged to the renter on the rental amount only — never on the delivery fee. Last changed{' '}
              {new Date(settings.updated_at).toLocaleString('en-PH')}.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-red-600">
            The platform service fee is not configured. New bookings will fail until it is.
          </p>
        )}
      </div>

      {settings && <ServiceFeeForm currentBps={settings.service_fee_bps} />}

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Rate change history</h2>
        {rows.length === 0 ? (
          <p className="text-center text-sm text-gray-500">The rate has never been changed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Admin</th>
                  <th className="px-2 py-2">Change</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                      {new Date(r.created_at).toLocaleString('en-PH')}
                    </td>
                    <td className="px-2 py-2 text-gray-900">{r.admin_email}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-semibold text-gray-900">
                      {rate(r.detail?.previous_bps)} → {rate(r.detail?.service_fee_bps)}
                    </td>
                    {/* Admin-authored free text. Rendered as text — never as HTML. */}
                    <td className="px-2 py-2 text-gray-700">
                      {typeof r.detail?.reason === 'string' ? r.detail.reason : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
