'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Printer } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { MOCK_PAYOUT_REQUESTS } from '@/lib/mock-data'
import { PayoutStatement } from '@/components/payouts/PayoutStatement'
import { Skeleton } from '@/components/ui/skeleton'
import type { PayoutRequest } from '@/types'

// One payout statement, read under the host's OWN session. The authorisation
// is `payout_requests`' SELECT-own RLS policy: another host's statement simply
// returns no row, which renders as "Statement not found" — there is no
// client-side ownership check to get wrong, and none to bypass.
export default function PayoutStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [request, setRequest] = useState<PayoutRequest | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setRequest(MOCK_PAYOUT_REQUESTS.find((r) => r.id === id) ?? null)
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data } = await supabase
      .from('payout_requests')
      .select('*, items:payout_items(*)')
      .eq('id', id)
      .maybeSingle()
    setRequest((data ?? null) as unknown as PayoutRequest | null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    load()
  }, [load])

  const backLink = (
    <Link
      href="/dashboard/payouts"
      className="no-print inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[#003049] transition-colors"
    >
      <ChevronLeft className="w-4 h-4" /> Back to Payouts
    </Link>
  )

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {backLink}
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    )
  }

  // Not theirs, or no such row — RLS returned nothing and we say nothing more.
  if (!request) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {backLink}
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="font-bold text-[#111827]">Statement not found</p>
          <p className="text-sm text-gray-500 mt-1">
            This payout statement doesn&apos;t exist, or it isn&apos;t yours.
          </p>
        </div>
      </div>
    )
  }

  // A draft has no number and no transfer — there is no document to show yet.
  if (request.status === 'pending') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {backLink}
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="font-bold text-[#111827]">This payout is still being prepared.</p>
          <p className="text-sm text-gray-500 mt-1">
            Your statement will appear here once the transfer has been made.
          </p>
        </div>
      </div>
    )
  }

  // A cancelled draft (failed, never reversed) also has no number, and the
  // host was never told it existed — treat it exactly as not found.
  if (!request.statement_number) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {backLink}
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="font-bold text-[#111827]">Statement not found</p>
          <p className="text-sm text-gray-500 mt-1">
            This payout statement doesn&apos;t exist, or it isn&apos;t yours.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="no-print flex items-center justify-between gap-4">
        {backLink}
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[#003049] hover:bg-[#002438] rounded-xl px-4 py-2.5 transition-colors"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <PayoutStatement request={request} items={request.items ?? []} />
    </div>
  )
}
