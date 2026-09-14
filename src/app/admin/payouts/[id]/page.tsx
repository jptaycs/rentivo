import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { PayoutStatement } from '@/components/payouts/PayoutStatement'
import { PrintButton } from '@/components/admin/PrintButton'
import { ResendStatementEmailButton } from '@/components/admin/ResendStatementEmailButton'
import { ReverseStatementAction } from '@/components/admin/ReverseStatementAction'
import type { PayoutItem, PayoutRequest } from '@/types'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

/**
 * One statement, as the admin sees it. `requireAdminPage()` runs in the admin
 * layout, which always renders before this page.
 *
 * The read goes through createAdminClient() DELIBERATELY — not by copying the
 * host page's shape. That page reads with the host's own session and leans
 * entirely on payout_requests' SELECT-own RLS policy; here the reader is an
 * admin who is not the statement's host, so under a user session that policy
 * would return nothing and this page would render "not found" for every real
 * statement.
 */
export default async function AdminPayoutStatementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const admin = createAdminClient()
  const { data } = await admin
    .from('payout_requests')
    .select('*, items:payout_items(*)')
    .eq('id', id)
    .maybeSingle()
  const request = (data ?? null) as unknown as (PayoutRequest & { items: PayoutItem[] }) | null

  const backLink = (
    <Link
      href="/admin/payouts"
      className="no-print inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 transition-colors hover:text-[#003049]"
    >
      <ChevronLeft className="h-4 w-4" /> Back to Payouts
    </Link>
  )

  if (!request) {
    return (
      <div className="space-y-6">
        {backLink}
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
          <p className="font-bold text-gray-900">Statement not found</p>
          <p className="mt-1 text-sm text-gray-500">No payout statement has that id.</p>
        </div>
      </div>
    )
  }

  // A draft has no number and no transfer, so there is no document to render.
  // Everything a draft can do lives on /admin/payouts.
  if (!request.statement_number) {
    const cancelled = request.status === 'failed'
    return (
      <div className="space-y-6">
        {backLink}
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
          <p className="font-bold text-gray-900">
            {cancelled ? 'This draft was cancelled.' : 'This statement is still a draft.'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {cancelled
              ? `${peso(request.amount)} was never transferred and no number was used${
                  request.notes ? ` — ${request.notes}` : ''
                }.`
              : 'Record the transfer from the Drafts section on the Payouts page to issue it.'}
          </p>
        </div>
      </div>
    )
  }

  const reversed = request.reversed_at !== null

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        {backLink}
        <div className="flex flex-wrap items-start gap-3">
          <ResendStatementEmailButton
            requestId={request.id}
            emailedAt={request.statement_emailed_at}
          />
          <PrintButton />
        </div>
      </div>

      <PayoutStatement request={request} items={request.items ?? []} />

      {!reversed && (
        <div className="no-print">
          <ReverseStatementAction
            requestId={request.id}
            statementNumber={request.statement_number}
            amountLabel={peso(request.amount)}
          />
        </div>
      )}
      {reversed && (
        <p className="no-print text-sm text-gray-500">
          This statement was already reversed. Its number stays used — the series never reuses one.
        </p>
      )}
    </div>
  )
}
