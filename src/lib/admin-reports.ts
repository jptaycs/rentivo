import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { LISTING_COLUMNS, PROFILE_COLUMNS } from '@/lib/listing-columns'

/**
 * Methods where Rentivo's OWN PayMongo account processes the payment, so the
 * service fee actually reaches Rentivo.
 *
 * Written as an explicit allowlist, never as a negation: `payment_method` is
 * nullable and its enum still carries unused apple_pay/google_pay values, so a
 * future method must be deliberately classified rather than silently counted as
 * revenue.
 *
 * Excluded on purpose:
 *   host_qr   — the renter pays the host's personal GCash/Maya QR directly.
 *               Rentivo never touches this money, so the fee is earned but
 *               never collected.
 *   test_skip — the pre-launch no-charge testing method.
 */
export const PAYMONGO_METHODS = ['card', 'gcash', 'maya', 'qrph'] as const

export interface MonthlyRevenue {
  month: string
  /**
   * Revenue-bearing money only: `rental_fee - discount + service_fee +
   * protection_fee + delivery_fee` (equivalently `total_amount -
   * security_deposit`, which is how it's actually computed below — that
   * identity holds by construction of create_booking's total_amount, so it
   * doesn't need discount/protection_fee to be selected separately).
   * Deliberately NOT total_amount: at this dataset's mix, ~61% of
   * total_amount is a refundable security deposit Rentivo is holding, not
   * revenue.
   *
   * The field is named `revenue`, not `gross`: it was briefly called `gross`
   * while it still held total_amount, and keeping that name after the value
   * became net of the deposit would have left the identifier meaning the
   * opposite of the number, guarded only by this comment. See depositsHeld
   * below for the excluded portion, broken out rather than silently dropped.
   */
  revenue: number
  /** The refundable security-deposit portion of total_amount, excluded from `revenue` above. Money Rentivo is holding, not earning. */
  depositsHeld: number
  earned: number
  collected: number
  uncollected: number
  payoutsPaid: number
  payoutsOwed: number
}

export interface InFlightRental {
  bookingRef: string
  listingTitle: string
  hostName: string
  renterName: string
  pickupDate: string
  returnDate: string
  status: string
  amount: number
}

export interface RankedRow {
  id: string
  label: string
  sublabel: string
  count: number
  /**
   * Same definition as MonthlyRevenue.revenue: `total_amount -
   * security_deposit`. Named `revenue` rather than a generic `value` so the
   * identifier states which of the two plausible money figures it holds —
   * the deposit-exclusive one.
   */
  revenue: number
}

export interface CommissionTotals {
  earned: number
  collected: number
  uncollected: number
}

const MONEY_SELECT =
  'service_fee, rental_fee, delivery_fee, security_deposit, total_amount, payment_method, created_at'

interface MoneyRow {
  service_fee: number
  rental_fee: number
  delivery_fee: number
  security_deposit: number
  total_amount: number
  payment_method: string | null
  created_at: string
}

async function paidBookings(): Promise<MoneyRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .select(MONEY_SELECT)
    // Refunded bookings are excluded for free: mark_booking_refunded moves
    // payment_status to 'refunded', so they never match 'paid'.
    .eq('payment_status', 'paid')
    .neq('status', 'cancelled')
  if (error) throw new Error(`Failed to load bookings: ${error.message}`)
  return (data ?? []) as MoneyRow[]
}

function isPaymongoMethod(method: string | null): boolean {
  return method !== null && (PAYMONGO_METHODS as readonly string[]).includes(method)
}

export async function getCommissionTotals(): Promise<CommissionTotals> {
  const rows = await paidBookings()
  const earned = rows.reduce((s, b) => s + b.service_fee, 0)
  const collected = rows.filter((b) => isPaymongoMethod(b.payment_method)).reduce((s, b) => s + b.service_fee, 0)
  return { earned, collected, uncollected: earned - collected }
}

/**
 * `YYYY-MM`, UTC. PostgREST returns `created_at` as a UTC ISO string, so
 * slicing the first 7 characters is already a UTC bucket. `lastNMonthKeys`
 * below is deliberately built the same way (via `Date.UTC`) so the two agree
 * on one basis — they used to disagree (this one UTC, that one
 * server-local), which is invisible on Vercel (UTC) but would, in local PH
 * dev (UTC+8), put a booking created 00:00–08:00 PHT on the 1st into the
 * previous month's bucket here while lastNMonthKeys' window edge used the
 * next one.
 */
function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** Last `n` UTC month keys ending with the current UTC month, oldest first — see monthKey's comment on why UTC. */
function lastNMonthKeys(n: number): string[] {
  const keys: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export async function getMonthlyRevenue(months = 12): Promise<MonthlyRevenue[]> {
  const admin = createAdminClient()

  // Bucketed by created_at — the booking's creation/payment moment — not
  // pickup_date. The service fee is earned when the booking is paid for, not
  // when the gear physically changes hands, so that's the month it should
  // count against.
  const bookings = await paidBookings()

  // payout_requests has no `created_at` column (the brief's wording used the
  // generic name; the real timestamp column is `requested_at`), so that's
  // what payoutsPaid/payoutsOwed bucket by.
  const { data: payoutData, error: payoutError } = await admin
    .from('payout_requests')
    .select('amount, status, requested_at')
  if (payoutError) throw new Error(`Failed to load payout_requests: ${payoutError.message}`)
  const payouts = (payoutData ?? []) as { amount: number; status: string; requested_at: string }[]

  // Seed every month in the window first so a quiet period renders as an
  // explicit zero row rather than being skipped entirely.
  const byMonth = new Map<string, MonthlyRevenue>()
  for (const key of lastNMonthKeys(months)) {
    byMonth.set(key, {
      month: key,
      revenue: 0,
      depositsHeld: 0,
      earned: 0,
      collected: 0,
      uncollected: 0,
      payoutsPaid: 0,
      payoutsOwed: 0,
    })
  }

  for (const b of bookings) {
    const key = monthKey(b.created_at)
    const row = byMonth.get(key)
    if (!row) continue // outside the requested window
    // total_amount - security_deposit = rental_fee - discount + service_fee
    // + protection_fee + delivery_fee by construction of create_booking's
    // insert — the revenue-bearing figure, see MonthlyRevenue.revenue's doc.
    row.revenue += b.total_amount - b.security_deposit
    row.depositsHeld += b.security_deposit
    row.earned += b.service_fee
    if (isPaymongoMethod(b.payment_method)) {
      row.collected += b.service_fee
    } else {
      row.uncollected += b.service_fee
    }
  }

  for (const p of payouts) {
    const key = monthKey(p.requested_at)
    const row = byMonth.get(key)
    if (!row) continue
    if (p.status === 'paid') row.payoutsPaid += p.amount
    if (p.status === 'pending') row.payoutsOwed += p.amount
  }

  return lastNMonthKeys(months).map((key) => byMonth.get(key)!)
}

interface InFlightBookingRow {
  booking_ref: string
  pickup_date: string
  return_date: string
  status: string
  total_amount: number
  listing: { title: string } | null
  host: { full_name: string } | null
  renter: { full_name: string } | null
}

export async function getInFlightRentals(): Promise<InFlightRental[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .select(
      `booking_ref, pickup_date, return_date, status, total_amount,
       listing:listings!bookings_listing_id_fkey(${LISTING_COLUMNS}),
       host:profiles!bookings_host_id_fkey(${PROFILE_COLUMNS}),
       renter:profiles!bookings_renter_id_fkey(${PROFILE_COLUMNS})`
    )
    .in('status', ['pending', 'confirmed', 'active'])
    .order('pickup_date', { ascending: true })
  if (error) throw new Error(`Failed to load in-flight rentals: ${error.message}`)

  return ((data ?? []) as unknown as InFlightBookingRow[]).map((b) => ({
    bookingRef: b.booking_ref,
    listingTitle: b.listing?.title ?? 'Unknown listing',
    hostName: b.host?.full_name ?? 'Unknown host',
    renterName: b.renter?.full_name ?? 'Unknown renter',
    pickupDate: b.pickup_date,
    returnDate: b.return_date,
    status: b.status,
    amount: b.total_amount,
  }))
}

interface RankableBookingRow {
  listing_id: string
  host_id: string
  renter_id: string
  total_amount: number
  security_deposit: number
  listing: { title: string; brand: string } | null
  host: { full_name: string; city: string | null } | null
  renter: { full_name: string; city: string | null } | null
}

/**
 * The dataset backing top-listings/hosts/renters is small (this app's whole
 * booking history), so aggregating in memory here is simpler and cheaper than
 * standing up a database view just to get PostgREST to `group by` — there's
 * no present benefit to pushing this down to SQL at this scale.
 */
async function rankableBookings(): Promise<RankableBookingRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .select(
      `listing_id, host_id, renter_id, total_amount, security_deposit,
       listing:listings!bookings_listing_id_fkey(${LISTING_COLUMNS}),
       host:profiles!bookings_host_id_fkey(${PROFILE_COLUMNS}),
       renter:profiles!bookings_renter_id_fkey(${PROFILE_COLUMNS})`
    )
    .eq('payment_status', 'paid')
    .neq('status', 'cancelled')
  if (error) throw new Error(`Failed to load bookings for ranking: ${error.message}`)
  return (data ?? []) as unknown as RankableBookingRow[]
}

function rank(
  rows: RankableBookingRow[],
  keyOf: (r: RankableBookingRow) => string,
  labelOf: (r: RankableBookingRow) => { label: string; sublabel: string },
  limit: number
): RankedRow[] {
  const byId = new Map<string, RankedRow>()
  for (const r of rows) {
    const id = keyOf(r)
    if (!id) continue
    // Revenue-bearing amount, same definition and same reasoning as
    // MonthlyRevenue.revenue: total_amount minus the refundable security
    // deposit. A "top host/renter/listing" ranking by GMV should not credit
    // (or blame) anyone for money Rentivo is only holding and will give
    // back.
    const revenueAmount = r.total_amount - r.security_deposit
    const existing = byId.get(id)
    if (existing) {
      existing.count += 1
      existing.revenue += revenueAmount
    } else {
      const { label, sublabel } = labelOf(r)
      byId.set(id, { id, label, sublabel, count: 1, revenue: revenueAmount })
    }
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, limit)
}

export async function getTopListings(limit = 10): Promise<RankedRow[]> {
  const rows = await rankableBookings()
  return rank(
    rows,
    (r) => r.listing_id,
    (r) => ({ label: r.listing?.title ?? 'Unknown listing', sublabel: r.listing?.brand ?? '' }),
    limit
  )
}

// Deliberately INCLUDES anonymized/deleted accounts ("Deleted User", city
// null — see src/lib/account-deletion.ts) in these two rankings rather than
// filtering them out. Their historical bookings are real revenue that
// actually happened; dropping them would make a money report undercount the
// past on top of the account no longer existing. They surface honestly as
// "Deleted User" with whatever fields survived anonymization — but since
// account-deletion.ts nulls `city` too, two deleted accounts would otherwise
// render as visually identical rows (same label, same empty sublabel),
// distinguishable only by an invisible id. deletedSublabel below appends a
// short id fragment so the inclusion is legible the moment it first fires,
// rather than reading as a rendering bug.
function deletedSublabel(name: string, id: string, city: string | null): string {
  return name === 'Deleted User' ? `account deleted · ${id.slice(0, 8)}` : (city ?? '')
}

export async function getTopHosts(limit = 10): Promise<RankedRow[]> {
  const rows = await rankableBookings()
  return rank(
    rows,
    (r) => r.host_id,
    (r) => {
      const name = r.host?.full_name ?? 'Unknown host'
      return { label: name, sublabel: deletedSublabel(name, r.host_id, r.host?.city ?? null) }
    },
    limit
  )
}

export async function getTopRenters(limit = 10): Promise<RankedRow[]> {
  const rows = await rankableBookings()
  return rank(
    rows,
    (r) => r.renter_id,
    (r) => {
      const name = r.renter?.full_name ?? 'Unknown renter'
      return { label: name, sublabel: deletedSublabel(name, r.renter_id, r.renter?.city ?? null) }
    },
    limit
  )
}
