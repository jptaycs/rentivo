'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BillRunForm({ defaultPeriod }: { defaultPeriod: string /* YYYY-MM */ }) {
  const router = useRouter()
  const [period, setPeriod] = useState(defaultPeriod)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function run() {
    if (!confirm(`Generate commission bills for ${period}? Hosts are emailed immediately. Rerunning a month creates nothing new.`)) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/bills/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period }) })
      const json = await res.json()
      setResult(res.ok ? (json.created === 0 ? 'Nothing to bill for that month.' : `Created ${json.created} bill${json.created === 1 ? '' : 's'}.`) : json.error ?? 'Run failed.')
      if (res.ok) router.refresh()
    } catch {
      setResult('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <label className="text-sm text-gray-600">Month</label>
      <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
      <button type="button" onClick={run} disabled={busy} className="rounded-full bg-[#003049] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? 'Running…' : 'Run billing'}
      </button>
      {result && <p className="text-sm text-gray-700">{result}</p>}
    </div>
  )
}
