import {
  getCommissionTotals,
  getMonthlyRevenue,
  getInFlightRentals,
  getTopListings,
  getTopHosts,
  getTopRenters,
  getUnrequestedPayouts,
  type RankedRow,
} from '@/lib/admin-reports'
import { requireAdminPage } from '@/lib/admin'
import { SERVICE_FEE_RATE } from '@/lib/pricing'
import { POLICY_START_LABEL } from '@/lib/billing'
import { ExportRevenueButton, ExportInFlightButton, ExportRankedButton, ExportUnrequestedButton } from './ReportExports'

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

  const [commission, monthly, inFlight, topListings, topHosts, topRenters, unrequested] = await Promise.all([
    getCommissionTotals(),
    getMonthlyRevenue(),
    getInFlightRentals(),
    getTopListings(),
    getTopHosts(),
    getTopRenters(),
    getUnrequestedPayouts(),
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Billed</p>
            <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(commission.billed)}</p>
            <p className="mt-2 text-xs text-gray-500">
              Commission bills issued or paid to hosts for host-QR bookings since {POLICY_START_LABEL}.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bill Payments</p>
            <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(commission.billPayments)}</p>
            <p className="mt-2 text-xs text-gray-500">
              Collected through commission bills. Billed minus this is what hosts still owe.
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
          earning. Payouts Paid is bucketed by the month a payout was actually settled, not the month it was
          requested. Payouts Pending counts only payouts hosts have <em>requested</em> and that are still open — it
          is not total liability to hosts; eligible earnings a host hasn&apos;t yet requested are in Unrequested
          Payouts below.
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
                {/* "Payouts Pending", not "Payouts Owed": this counts only
                    payouts a host has actively REQUESTED and that are still
                    open. Eligible-but-unrequested host earnings are owed too
                    and are not on this page, so "Owed" read as a liability
                    total it never was. */}
                <th className="px-4 py-3">Payouts Pending</th>
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
                  <td className="px-4 py-3">{peso(m.payoutsRequestedPending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Unrequested payouts ──
          The other half of host liability. "Payouts Pending" above only
          counts money a host has asked for; this is money request_payout()
          WOULD pay today that nobody has asked for. Together they are what
          the platform owes hosts. Eligibility mirrors request_payout()'s CTE
          — see getUnrequestedPayouts() for the rule and the drift warning. */}
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-900">Unrequested Payouts</h2>
          <ExportUnrequestedButton rows={unrequested.hosts} />
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Completed, paid, payout-eligible bookings not yet claimed by any payout request — what Request Payout would
          pay each host right now. Host-QR and test bookings are excluded, exactly as <code>request_payout()</code>{' '}
          excludes them. Blocker says why the host can&apos;t request yet, when the data can tell.
        </p>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Owed, Unrequested</p>
            <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(unrequested.total)}</p>
            <p className="mt-2 text-xs text-gray-500">
              {`Across ${unrequested.bookings} eligible ${unrequested.bookings === 1 ? 'booking' : 'bookings'} and ${unrequested.hosts.length} ${unrequested.hosts.length === 1 ? 'host' : 'hosts'}.`}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Owed To Hosts</p>
            <p className="mt-1 text-3xl font-bold text-[#003049]">
              {peso(unrequested.total + monthly.reduce((s, m) => s + m.payoutsRequestedPending, 0))}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Unrequested plus the requested-and-still-pending payouts in the table above.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          {unrequested.hosts.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-500">Nothing owed that hasn&apos;t been requested.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Eligible Bookings</th>
                  <th className="px-4 py-3">Owed</th>
                  <th className="px-4 py-3">Blocker</th>
                </tr>
              </thead>
              <tbody>
                {unrequested.hosts.map((h) => (
                  <tr key={h.hostId} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{h.hostName}</p>
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
                        <span className="text-xs text-gray-500">None — not yet requested</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Rentals in flight ── */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-900">Rentals In Flight</h2>
          <ExportInFlightButton rows={inFlight} />
        </div>
        {/* The money column here is the booking's full total, which unlike
            every other money figure on this page still INCLUDES the refundable
            security deposit — it's what the renter paid, or still owes, for a
            rental that hasn't finished. Header says "Booking Total" rather
            than "Amount" so it can't be read as the same basis as Revenue
            above.

            This list is NOT filtered on payment_status — a pending booking is
            routinely unpaid and an admin needs to see it — so the caption used
            to say "the full amount charged", which is simply false for those
            rows. The Payment column now states it per row, matching the host
            dashboard's "Awaiting payment" chip (commit 3db5883). */}
        <p className="mb-4 text-xs text-gray-500">
          Booking Total is the booking&apos;s full amount including the refundable security deposit — unlike the
          Revenue figures above, which exclude it. It is only money actually taken where Payment says{' '}
          <span className="font-semibold">paid</span>; an unpaid row is an amount owed, not collected.
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
                  <th className="px-4 py-3">Payment</th>
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
                    <td className="px-4 py-3">
                      {r.paymentStatus === 'paid' ? (
                        <span className="capitalize text-gray-600">{r.paymentStatus}</span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold capitalize text-amber-800">
                          {r.paymentStatus === 'unpaid' ? 'Awaiting payment' : r.paymentStatus}
                        </span>
                      )}
                    </td>
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
