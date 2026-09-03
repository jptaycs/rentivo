'use client'

import { useState } from 'react'
import { Receipt, ChevronDown, ChevronUp, Loader2, CheckCircle2, Clock, AlertCircle, Ban } from 'lucide-react'
import { useHostBills } from '@/hooks/useHostBills'
import { periodLabel, isOverdue, GRACE_DAYS } from '@/lib/billing'
import { BillPayModal } from '@/components/dashboard/BillPayModal'
import type { HostBill } from '@/types'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`
const date = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
const dateOnly = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}/${y}` }

function StatusPill({ bill }: { bill: HostBill }) {
  if (bill.status === 'paid') return <span className="text-xs bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Paid</span>
  if (bill.status === 'void') return <span className="text-xs bg-gray-100 text-gray-600 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Ban className="w-3 h-3" /> Void</span>
  if (isOverdue(bill)) return <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Overdue</span>
  return <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Clock className="w-3 h-3" /> Issued</span>
}

export default function BillsPage() {
  const { bills, loading, outstanding, reload, pay, verify } = useHostBills()
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
  const [qr, setQr] = useState<{ billId: string; image: string; amount: number } | null>(null)
  const [error, setError] = useState('')

  async function handlePay(bill: HostBill) {
    setPaying(bill.id)
    setError('')
    const r = await pay(bill.id)
    setPaying(null)
    if ('error' in r) { setError(r.error); return }
    if ('qrImage' in r) { setQr({ billId: bill.id, image: r.qrImage, amount: bill.amount }); return }
    // A second click can find a previously-minted intent already succeeded
    // (e.g. the webhook landed between the first click and this one) — the
    // route marks the bill paid directly and returns no QR to show.
    await reload()
  }

  const anyOverdue = bills.some((b) => isOverdue(b))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111827] flex items-center gap-2"><Receipt className="w-6 h-6 text-[#003049]" /> Bills</h1>
        <p className="text-sm text-gray-500 mt-1">5% commission on direct QR bookings, billed monthly. Due {GRACE_DAYS} days after issue.</p>
      </div>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Outstanding</p>
        <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(outstanding)}</p>
        {anyOverdue && (
          <p className="mt-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            You have an overdue bill. Renters can&apos;t pay you by direct QR until it&apos;s settled — your listings stay live through Rentivo&apos;s other payment methods.
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-gray-300 animate-spin" /></div>
      ) : bills.length === 0 ? (
        <p className="text-center text-sm text-gray-500 py-10">No bills yet. You&apos;re billed for months where your direct QR service fees reach ₱100 — smaller amounts roll into the next bill.</p>
      ) : (
        <div className="space-y-3">
          {bills.map((bill) => (
            <div key={bill.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-[#111827]">{periodLabel(bill.period)}</p>
                  <p className="text-xs text-gray-500">Issued {date(bill.issued_at)} · Due {date(bill.due_at)}{bill.paid_at ? ` · Paid ${date(bill.paid_at)}` : ''}</p>
                  {bill.void_reason && <p className="text-xs text-gray-500">Void: {bill.void_reason}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill bill={bill} />
                  <p className="text-lg font-bold text-[#003049]">{peso(bill.amount)}</p>
                  {bill.status === 'issued' && (
                    <button type="button" onClick={() => handlePay(bill)} disabled={paying === bill.id}
                      className="bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                      {paying === bill.id && <Loader2 className="w-4 h-4 animate-spin" />} Pay
                    </button>
                  )}
                  <button type="button" onClick={() => setOpen(open === bill.id ? null : bill.id)} aria-label="Toggle breakdown" className="text-gray-400 hover:text-gray-600">
                    {open === bill.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              {open === bill.id && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="text-xs text-gray-500 border-b border-gray-100"><th className="py-2 pr-3">Booking</th><th className="py-2 pr-3">Dates</th><th className="py-2 pr-3">Paid</th><th className="py-2 pr-3 text-right">Rental</th><th className="py-2 text-right">Fee</th></tr></thead>
                    <tbody>
                      {(bill.items ?? []).map((i) => (
                        <tr key={i.id} className="border-b border-gray-50">
                          <td className="py-2 pr-3 font-medium">{i.booking?.booking_ref ?? '—'}</td>
                          <td className="py-2 pr-3">{i.booking ? `${dateOnly(i.booking.pickup_date)} – ${dateOnly(i.booking.return_date)}` : '—'}</td>
                          <td className="py-2 pr-3">{i.booking?.paid_at ? date(i.booking.paid_at) : '—'}</td>
                          <td className="py-2 pr-3 text-right">{i.booking ? peso(i.booking.rental_fee) : '—'}</td>
                          <td className="py-2 text-right font-semibold">{peso(i.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BillPayModal
        billId={qr?.billId ?? null}
        qrImage={qr?.image ?? null}
        amountLabel={qr ? peso(qr.amount) : ''}
        onClose={() => setQr(null)}
        onPaid={() => { setQr(null); reload() }}
        verify={verify}
      />
    </div>
  )
}
