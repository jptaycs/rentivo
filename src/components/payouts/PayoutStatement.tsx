'use client'

import { AlertTriangle } from 'lucide-react'
import { BUSINESS, BUSINESS_ADDRESS } from '@/lib/business'
import { formatFeeRate } from '@/lib/pricing'
import type { PayoutItem, PayoutRequest } from '@/types'

// The payout statement document. Presentational only — it fetches nothing and
// reads nothing but the row and items handed to it, which are SNAPSHOTS taken
// when the draft was prepared (migration 082). It must never join back to
// bookings or listings: a statement is a document, and renaming a listing may
// not change what an already-issued statement says was paid.
//
// Used by BOTH /dashboard/payouts/[id] (the host) and /admin/payouts/[id].
// It carries `id="receipt-print-area"`, which the print stylesheet in
// globals.css uses to strip the page down to this block alone — so a page
// rendering this must not render a second #receipt-print-area.

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

function longDate(value: string) {
  // Date-only columns (transferred_on, pickup_date, return_date) are plain
  // 'YYYY-MM-DD'. Parsing those with `new Date()` treats them as UTC midnight,
  // which renders as the previous day west of Greenwich — harmless in Manila
  // but wrong for anyone printing this elsewhere, so format them by parts.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value)
  return d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
}

function shortDate(value: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Account numbers are shown by their last four digits only — on screen, in
 *  print and in the emailed copy. Nothing renders the full number. */
export function maskAccountNumber(number: string | null) {
  if (!number) return '—'
  return `•••• ${number.slice(-4)}`
}

interface Props {
  request: PayoutRequest
  items: PayoutItem[]
}

export function PayoutStatement({ request, items }: Props) {
  const reversed = Boolean(request.reversed_at)

  // Every figure on this document comes from the item snapshots. Rentivo's
  // model is renter-pays: the service fee is charged to the renter ON TOP of
  // the host's rate, and the host is paid rental + delivery in full. So gross
  // is what the renter paid, the fee is what Rentivo kept, and the difference
  // is exactly what was transferred — the identity below holds by construction.
  const totalRental = items.reduce((s, i) => s + i.rental_fee, 0)
  const totalDelivery = items.reduce((s, i) => s + i.delivery_fee, 0)
  const totalServiceFee = items.reduce((s, i) => s + i.service_fee, 0)
  const gross = totalRental + totalDelivery + totalServiceFee
  const net = totalRental + totalDelivery

  // The statement's own arithmetic must agree with the amount that was
  // actually transferred. If it ever doesn't, say so on the document rather
  // than quietly printing a number nobody can reconcile.
  const discrepancy = net !== request.amount

  const pickups = items.map((i) => i.pickup_date).sort()
  const returns = items.map((i) => i.return_date).sort()
  const periodFrom = pickups[0]
  const periodTo = returns[returns.length - 1]

  return (
    <div id="receipt-print-area" className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-[#003049] px-6 py-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-blue-200 text-xs font-medium">Payout Statement</p>
            <p className="text-white font-bold text-xl tracking-wider">{request.statement_number ?? '—'}</p>
          </div>
          {reversed ? (
            <span className="text-xs font-bold bg-red-100 text-red-700 px-3 py-1.5 rounded-full">REVERSED</span>
          ) : (
            <span className="text-xs font-bold bg-green-100 text-green-700 px-3 py-1.5 rounded-full">Paid</span>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-5">
          <div>
            <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wider">Issued</p>
            <p className="text-white text-sm font-semibold">
              {request.processed_at ? longDate(request.processed_at) : '—'}
            </p>
          </div>
          <div>
            <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wider">Transfer date</p>
            <p className="text-white text-sm font-semibold">
              {request.transferred_on ? longDate(request.transferred_on) : '—'}
            </p>
          </div>
          <div>
            <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wider">Reference</p>
            <p className="text-white text-sm font-semibold break-all">{request.reference ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* A reversed statement keeps its number, so it must be unmistakable on
          the page — a host must never read a reversed payout as money they
          still hold. */}
      {reversed && (
        <div className="bg-red-50 border-b border-red-100 px-6 py-4">
          <p className="text-sm font-bold text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            This payout was reversed on {longDate(request.reversed_at as string)}.
          </p>
          {request.reversal_reason && (
            <p className="text-sm text-red-700/90 mt-1.5">{request.reversal_reason}</p>
          )}
          <p className="text-xs text-red-700/80 mt-1.5">
            The bookings listed below are owed to you again and will be included in a future statement.
          </p>
        </div>
      )}

      {/* From / Paid to */}
      <div className="grid sm:grid-cols-2 gap-6 px-6 py-5 border-b border-gray-100">
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">From</p>
          <p className="text-sm font-bold text-[#111827]">{BUSINESS.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">DTI No. {BUSINESS.dtiNumber}</p>
          <p className="text-xs text-gray-500">{BUSINESS_ADDRESS}</p>
          <p className="text-xs text-gray-500">{BUSINESS.email}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Paid to</p>
          <p className="text-sm font-bold text-[#111827]">{request.account_name ?? '—'}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {request.account_method ?? '—'} {maskAccountNumber(request.account_number)}
          </p>
        </div>
      </div>

      {/* Period */}
      <div className="px-6 py-4 border-b border-gray-100">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Period covered</p>
        <p className="text-sm font-semibold text-[#111827]">
          {periodFrom && periodTo ? `${longDate(periodFrom)} — ${longDate(periodTo)}` : '—'}
        </p>
      </div>

      {/* Bookings */}
      <div className="px-6 py-5 border-b border-gray-100">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">
          Bookings ({items.length})
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="text-left font-bold py-2 pr-3">Booking</th>
                <th className="text-left font-bold py-2 pr-3">Dates</th>
                <th className="text-right font-bold py-2 pr-3">Rental</th>
                <th className="text-right font-bold py-2 pr-3">Delivery</th>
                <th className="text-right font-bold py-2 pr-3">Service fee</th>
                <th className="text-right font-bold py-2">Your earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item) => (
                <tr key={item.booking_id} className="align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-[#111827] tracking-wider text-xs">{item.booking_ref}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.listing_title}</p>
                  </td>
                  <td className="py-3 pr-3 text-xs text-gray-500 whitespace-nowrap">
                    {shortDate(item.pickup_date)} – {shortDate(item.return_date)}
                  </td>
                  <td className="py-3 pr-3 text-right text-[#111827] whitespace-nowrap">{peso(item.rental_fee)}</td>
                  <td className="py-3 pr-3 text-right text-[#111827] whitespace-nowrap">{peso(item.delivery_fee)}</td>
                  <td className="py-3 pr-3 text-right text-gray-500 whitespace-nowrap">
                    {peso(item.service_fee)}
                    {item.service_fee_bps !== null && (
                      <span className="text-xs text-gray-400"> ({formatFeeRate(item.service_fee_bps)})</span>
                    )}
                  </td>
                  <td className="py-3 text-right font-bold text-[#111827] whitespace-nowrap">
                    {peso(item.rental_fee + item.delivery_fee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="px-6 py-5 bg-[#F8FAFC]">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Gross booking value</span>
            <span className="font-medium text-[#111827]">{peso(gross)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Less: Rentivo service fee</span>
            <span className="font-medium text-[#111827]">−{peso(totalServiceFee)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 pl-4">of which delivery fees (paid to you in full)</span>
            <span className="font-medium text-gray-500">{peso(totalDelivery)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-3 mt-3">
            <span className="font-bold text-[#111827]">Net paid to you</span>
            <span className="font-bold text-lg text-[#003049]">{peso(net)}</span>
          </div>
        </div>

        {discrepancy && (
          <p className="mt-4 text-sm font-semibold text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            The bookings listed total {peso(net)} but {peso(request.amount)} was recorded as transferred. Please
            contact {BUSINESS.email}.
          </p>
        )}

        <p className="mt-4 text-xs text-gray-500 leading-relaxed">
          The service fee was charged to renters on top of your rental price at checkout. It was not deducted from
          your rental rate.
        </p>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          This is a payout statement from {BUSINESS.name}. It is not an official receipt or invoice.
        </p>
      </div>
    </div>
  )
}
