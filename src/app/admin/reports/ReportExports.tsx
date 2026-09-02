'use client'

import { toCsv } from '@/lib/csv'
import type { MonthlyRevenue, InFlightRental, RankedRow } from '@/lib/admin-reports'

// Client component: takes the already-fetched rows the server page fetched
// via Task 9's report functions as props and does not re-query anything —
// it only turns them into a CSV blob and triggers a download.
function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const buttonClass =
  'rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-semibold text-[#003049] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md'

export function ExportRevenueButton({ rows }: { rows: MonthlyRevenue[] }) {
  const handleClick = () => {
    const csv = toCsv(
      // "Payouts Pending" mirrors the on-page header — it counts only
      // payouts hosts have requested and that are still open, which is not
      // total liability to hosts. See MonthlyRevenue's field docs.
      ['Month', 'Revenue', 'Deposits Held', 'Earned', 'Collected', 'Uncollected', 'Payouts Paid', 'Payouts Pending'],
      rows.map((r) => [
        r.month,
        r.revenue,
        r.depositsHeld,
        r.earned,
        r.collected,
        r.uncollected,
        r.payoutsPaid,
        r.payoutsRequestedPending,
      ])
    )
    download('rentivo-revenue.csv', csv)
  }
  return (
    <button type="button" className={buttonClass} onClick={handleClick}>
      Download CSV
    </button>
  )
}

export function ExportInFlightButton({ rows }: { rows: InFlightRental[] }) {
  const handleClick = () => {
    const csv = toCsv(
      // "Booking Total", matching the on-page header: this figure still
      // includes the refundable security deposit, unlike the Revenue columns
      // in the revenue CSV above.
      ['Booking Ref', 'Listing', 'Host', 'Renter', 'Pickup', 'Return', 'Status', 'Payment', 'Booking Total'],
      rows.map((r) => [
        r.bookingRef,
        r.listingTitle,
        r.hostName,
        r.renterName,
        r.pickupDate,
        r.returnDate,
        r.status,
        r.paymentStatus,
        r.amount,
      ])
    )
    download('rentivo-in-flight.csv', csv)
  }
  return (
    <button type="button" className={buttonClass} onClick={handleClick}>
      Download CSV
    </button>
  )
}

const RANKED_FILENAMES = {
  listings: 'rentivo-top-listings.csv',
  hosts: 'rentivo-top-hosts.csv',
  renters: 'rentivo-top-renters.csv',
} as const

export function ExportRankedButton({
  rows,
  kind,
}: {
  rows: RankedRow[]
  kind: keyof typeof RANKED_FILENAMES
}) {
  const handleClick = () => {
    const csv = toCsv(
      ['Name', 'Detail', 'Bookings', 'Revenue'],
      rows.map((r) => [r.label, r.sublabel, r.count, r.revenue])
    )
    download(RANKED_FILENAMES[kind], csv)
  }
  return (
    <button type="button" className={buttonClass} onClick={handleClick}>
      Download CSV
    </button>
  )
}
