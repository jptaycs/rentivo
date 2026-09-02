import {
  getCommissionTotals,
  getMonthlyRevenue,
  getInFlightRentals,
  getTopListings,
  getTopHosts,
  getTopRenters,
  type RankedRow,
} from '@/lib/admin-reports'
import { requireAdminPage } from '@/lib/admin'
import { SERVICE_FEE_RATE } from '@/lib/pricing'
import { ExportRevenueButton, ExportInFlightButton, ExportRankedButton } from './ReportExports'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

// pickup_date/return_date are Postgres `date` columns — plain "YYYY-MM-DD",
// no time component. new Date("2026-09-01").toLocaleDateString() parses that
// as UTC midnight, which renders a day early in any negative-UTC-offset
// runtime (this project already fixed this exact class of bug once, see
// commit 082a1bf on the SearchBar date pickers). Format the string directly
// instead of round-tripping through Date/UTC.
const date = (dateOnly: string) => {
  const [y, m, d] = dateOnly.split('-').map(Number)
  return `${m}/${d}/${y}`
}

function RankedTable({ title, rows, kind }: { title: string; rows: RankedRow[]; kind: 'listings' | 'hosts' | 'renters' }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <ExportRankedButton rows={rows} kind={kind} />
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-sm text-gray-500">No data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Bookings</th>
                {/* "Revenue" — matches admin-reports.ts's RankedRow.revenue
                    definition (total_amount minus the refundable security
                    deposit), same figure as the Revenue Over Time section's
                    Revenue column. */}
                <th className="px-2 py-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="px-2 py-2">
                    <p className="font-medium text-gray-900">{r.label}</p>
                    {r.sublabel && <p className="text-xs text-gray-500">{r.sublabel}</p>}
                  </td>
                  <td className="px-2 py-2">{r.count}</td>
                  <td className="px-2 py-2 font-semibold">{peso(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default async function AdminReportsPage() {
  // Defense in depth: see the matching comment in /admin/users/page.tsx.
  await requireAdminPage()

  const [commission, monthly, inFlight, topListings, topHosts, topRenters] = await Promise.all([
    getCommissionTotals(),
    getMonthlyRevenue(),
    getInFlightRentals(),
    getTopListings(),
    getTopHosts(),
    getTopRenters(),
  ])

  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Business Reports</h1>
        <p className="text-sm text-gray-500">
          Commission is on the {SERVICE_FEE_RATE * 100}% service fee only, not the full rental amount — see the
          definitions below each card.
        </p>
      </div>

      {/* ── Commission ── */}
      <section>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Earned</p>
            <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(commission.earned)}</p>
            <p className="mt-2 text-xs text-gray-500">
              Total service fee on every paid, non-cancelled booking — regardless of payment method.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Collected</p>
            <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(commission.collected)}</p>
            <p className="mt-2 text-xs text-gray-500">
              Earned via card, GCash, Maya, or QR Ph — the methods Rentivo&apos;s own PayMongo account actually
              processes.
            </p>
          </div>
          {/* Amber, not red: uncollected revenue here is a fact about the
              business model (host-QR and test-skip bookings never route
              money through Rentivo), not an error to fix. */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Uncollected</p>
            <p className="mt-1 text-3xl font-bold text-amber-800">{peso(commission.uncollected)}</p>
            <p className="mt-2 text-xs text-amber-800">
              Earned on host-QR and test bookings — this money never reached Rentivo.
            </p>
          </div>
        </div>
      </section>

      {/* ── Revenue over time ──
          Rendered as a plain table rather than a chart: this repo has no
          charting library, and pulling one in for a six-series monthly
          table isn't justified by this one page. */}
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-900">Revenue Over Time</h2>
          <ExportRevenueButton rows={monthly} />
        </div>
        {/* This column was briefly "Gross" holding total_amount, which is
            ~61% refundable security deposit at this dataset's current mix —
            an owner skimming this page would read "Gross" as business done
            and be badly misled. Revenue below is the revenue-bearing figure
            (rental + service + delivery + any historical protection fee —
            i.e. everything except the deposit), with the held deposit broken
            out into its own clearly-labelled column so both figures are
            visible without either one misrepresenting the other. */}
        <p className="mb-4 text-xs text-gray-500">
          Revenue excludes refundable security deposits — see Deposits Held for the money Rentivo is holding, not
          earning.
        </p>
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Deposits Held</th>
                <th className="px-4 py-3">Earned</th>
                <th className="px-4 py-3">Collected</th>
                <th className="px-4 py-3">Uncollected</th>
                <th className="px-4 py-3">Payouts Paid</th>
                <th className="px-4 py-3">Payouts Owed</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.month}</td>
                  <td className="px-4 py-3">{peso(m.revenue)}</td>
                  <td className="px-4 py-3 text-amber-800">{peso(m.depositsHeld)}</td>
                  <td className="px-4 py-3">{peso(m.earned)}</td>
                  <td className="px-4 py-3">{peso(m.collected)}</td>
                  <td className="px-4 py-3">{peso(m.uncollected)}</td>
                  <td className="px-4 py-3">{peso(m.payoutsPaid)}</td>
                  <td className="px-4 py-3">{peso(m.payoutsOwed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Rentals in flight ── */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-900">Rentals In Flight</h2>
          <ExportInFlightButton rows={inFlight} />
        </div>
        {/* The money column here is the booking's full charged total, which
            unlike every other money figure on this page still INCLUDES the
            refundable security deposit — it's what the renter actually paid
            (or owes) for a rental that hasn't finished, not a revenue
            figure. Header says "Booking Total" rather than "Amount" so it
            can't be read as the same basis as Revenue above. */}
        <p className="mb-4 text-xs text-gray-500">
          Booking Total is the full amount charged, including the refundable security deposit — unlike the Revenue
          figures above, which exclude it.
        </p>
        {inFlight.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No pending, confirmed, or active rentals right now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-4 py-3">Ref</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Renter</th>
                  <th className="px-4 py-3">Pickup</th>
                  <th className="px-4 py-3">Return</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Booking Total</th>
                </tr>
              </thead>
              <tbody>
                {inFlight.map((r) => (
                  <tr key={r.bookingRef} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{r.bookingRef}</td>
                    <td className="px-4 py-3">{r.listingTitle}</td>
                    <td className="px-4 py-3">{r.hostName}</td>
                    <td className="px-4 py-3">{r.renterName}</td>
                    <td className="px-4 py-3">{date(r.pickupDate)}</td>
                    <td className="px-4 py-3">{date(r.returnDate)}</td>
                    <td className="px-4 py-3 capitalize">{r.status}</td>
                    <td className="px-4 py-3 font-semibold">{peso(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Top listings / hosts / renters ── */}
      <section>
        <h2 className="mb-4 text-xl font-bold text-gray-900">Top Performers</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <RankedTable title="Top Listings" rows={topListings} kind="listings" />
          <RankedTable title="Top Hosts" rows={topHosts} kind="hosts" />
          <RankedTable title="Top Renters" rows={topRenters} kind="renters" />
        </div>
      </section>
    </div>
  )
}
