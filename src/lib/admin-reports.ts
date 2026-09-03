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
  /**
   * Payout requests actually SETTLED in this month, bucketed by
   * `payout_requests.processed_at` — the timestamp `mark_payout_paid` sets
   * (020:47) — not by `requested_at`. Those differ: a payout requested Jan 28
   * and paid Feb 3 is February's cash outflow, and bucketing it by the request
   * date put it in January, in a column an owner reads as money that left the
   * business that month.
   */
  payoutsPaid: number
  /**
   * Payouts a host has REQUESTED that are still `pending`, bucketed by
   * `requested_at` (a pending request has no processed_at yet, by definition).
   *
   * This is NOT total liability to hosts. A host only appears here once they
   * have actively asked for their money; completed, paid, payout-eligible
   * bookings whose host has not yet clicked Request Payout are owed all the
   * same — that figure is getUnrequestedPayouts(), shown in its own section
   * on the reports page since 2026-09-04. The field is named
   * `payoutsRequestedPending`, not `payoutsOwed`, precisely so the identifier
   * cannot be read as the broader figure — see the on-page caption too.
   */
  payoutsRequestedPending: number
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
  /**
   * `unpaid` / `paid` / `refunded`. Present because `status` alone
   * (pending|confirmed|active) says nothing about whether the money arrived:
   * a `pending` booking is routinely unpaid, so captioning the amount column
   * "the full amount charged" is false for those rows. Same distinction the
   * host dashboard draws with its "Awaiting payment" chip (commit 3db5883).
   */
  paymentStatus: string
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
  /**
   * Sum of `host_bills.amount` for bills in `issued` or `paid` status — the
   * uncollected commission that has actually been turned into a bill a host
   * owes (as opposed to `uncollected` above, which is every host-QR/test
   * booking's service fee regardless of whether a bill exists for it yet:
   * `generate_host_bills` only bills bookings paid at or after
   * POLICY_START, and only in ₱100+ monthly batches, so `billed` is always
   * <= `uncollected`, never equal). Void bills are excluded — they were
   * corrected or waived, not owed.
   */
  billed: number
  /** Sum of `host_bills.amount` for bills in `paid` status — commission that was uncollected at checkout but has since actually reached Rentivo via a bill payment. */
  billPayments: number
}

/**
 * One host's payout-eligible earnings that no payout request has claimed.
 * See getUnrequestedPayouts() for the eligibility definition.
 */
export interface UnrequestedPayoutRow {
  hostId: string
  hostName: string
  /** City, or the deleted-account disambiguator — same shape as RankedRow.sublabel. */
  sublabel: string
  /** Eligible, unclaimed bookings behind `amount`. */
  bookings: number
  /** Sum of rental_fee + delivery_fee over those bookings — what request_payout() would pay. */
  amount: number
  /**
   * Why this money is still sitting here, when it can be told from the data:
   * the host has no payout account, theirs isn't verified yet, was rejected,
   * they're suspended (046 blocks request_payout), or they already have a
   * pending request (only one at a time; these bookings would join the next
   * one). `null` means nothing is stopping them — they just haven't asked.
   */
  blocker: string | null
}

export interface UnrequestedPayouts {
  /** Platform-wide total owed to hosts that nobody has requested yet. */
  total: number
  bookings: number
  /** Per host, largest amount first. */
  hosts: UnrequestedPayoutRow[]
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

  const admin = createAdminClient()
  const { data: billRows, error: billError } = await admin.from('host_bills').select('amount, status')
  if (billError) throw new Error(`Failed to load host_bills: ${billError.message}`)
  const bills = (billRows ?? []) as { amount: number; status: string }[]
  const billed = bills.filter((b) => b.status === 'issued' || b.status === 'paid').reduce((s, b) => s + b.amount, 0)
  const billPayments = bills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount, 0)

  return { earned, collected, uncollected: earned - collected, billed, billPayments }
}

/**
 * Host earnings that are eligible for a payout but that no host has requested.
 *
 * This is the figure "Payouts Pending" deliberately does NOT include (see
 * MonthlyRevenue.payoutsRequestedPending): liability the platform carries
 * whether or not anyone has clicked Request Payout. The eligibility rule is a
 * line-for-line mirror of the `eligible` CTE in request_payout() — 046 is the
 * authoritative body — minus its `host_id = auth.uid()` scope:
 *   status = 'completed' and payment_status = 'paid'
 *   and payment_method is distinct from 'host_qr'   (029: paid to the host directly)
 *   and payment_method is distinct from 'test_skip' (033: never charged)
 *   and not itemized in a payout_request whose status is 'pending' or 'paid'
 *   payable = rental_fee + delivery_fee                (038)
 * If request_payout()'s CTE changes, change this in the same commit — the
 * whole value of the number is that it predicts what request_payout() would
 * pay, and the one prior enumeration-style figure on this page drifted from
 * create_booking exactly this way (see MonthlyRevenue.revenue's doc).
 *
 * A `failed` payout request releases its bookings (they are NOT in the
 * exclusion), matching request_payout(): a host whose payout bounced is owed
 * that money again.
 */
export async function getUnrequestedPayouts(): Promise<UnrequestedPayouts> {
  const admin = createAdminClient()

  const [{ data: bookingData, error: bookingError }, { data: itemData, error: itemError }] =
    await Promise.all([
      admin
        .from('bookings')
        .select(
          `id, host_id, rental_fee, delivery_fee,
           host:profiles!bookings_host_id_fkey(${PROFILE_COLUMNS})`
        )
        .eq('status', 'completed')
        .eq('payment_status', 'paid')
        // PostgREST has no `is distinct from`; `payment_method` is nullable
        // and a null method (pre-payment-method bookings) IS eligible in the
        // RPC, so build the same truth table explicitly: null, or not one of
        // the two excluded values.
        .or('payment_method.is.null,payment_method.not.in.(host_qr,test_skip)'),
      admin
        .from('payout_items')
        .select('booking_id, request:payout_requests!payout_items_payout_request_id_fkey(status)'),
    ])
  if (bookingError) throw new Error(`Failed to load completed bookings: ${bookingError.message}`)
  if (itemError) throw new Error(`Failed to load payout_items: ${itemError.message}`)

  const claimed = new Set(
    ((itemData ?? []) as unknown as { booking_id: string; request: { status: string } | null }[])
      .filter((i) => i.request?.status === 'pending' || i.request?.status === 'paid')
      .map((i) => i.booking_id)
  )

  type Row = {
    id: string
    host_id: string
    rental_fee: number
    delivery_fee: number
    host: { full_name: string; city: string | null } | null
  }
  const eligible = ((bookingData ?? []) as unknown as Row[]).filter((b) => !claimed.has(b.id))

  const byHost = new Map<string, UnrequestedPayoutRow>()
  for (const b of eligible) {
    let row = byHost.get(b.host_id)
    if (!row) {
      const name = b.host?.full_name ?? 'Unknown host'
      row = {
        hostId: b.host_id,
        hostName: name,
        sublabel: deletedSublabel(name, b.host_id, b.host?.city ?? null),
        bookings: 0,
        amount: 0,
        blocker: null,
      }
      byHost.set(b.host_id, row)
    }
    row.bookings += 1
    row.amount += b.rental_fee + b.delivery_fee
  }

  // Explain, where the data can, why each host hasn't requested. Only
  // fetched for the hosts that actually appear — usually a handful.
  const hostIds = [...byHost.keys()]
  if (hostIds.length > 0) {
    const [{ data: accounts }, { data: pendingRequests }, { data: profiles }] = await Promise.all([
      admin.from('payout_accounts').select('user_id, status').in('user_id', hostIds),
      admin.from('payout_requests').select('host_id').eq('status', 'pending').in('host_id', hostIds),
      admin.from('profiles').select('id, suspended_at').in('id', hostIds),
    ])
    const accountStatus = new Map((accounts ?? []).map((a) => [a.user_id as string, a.status as string]))
    const hasPending = new Set((pendingRequests ?? []).map((r) => r.host_id as string))
    const suspended = new Set(
      (profiles ?? []).filter((p) => p.suspended_at !== null).map((p) => p.id as string)
    )
    // Order matches request_payout()'s own guard order, so the blocker shown
    // is the one the host would actually hit first.
    for (const row of byHost.values()) {
      const status = accountStatus.get(row.hostId)
      if (suspended.has(row.hostId)) row.blocker = 'Suspended — payouts on hold'
      else if (!status) row.blocker = 'No payout account'
      else if (status === 'pending') row.blocker = 'Payout account awaiting review'
      else if (status === 'rejected') row.blocker = 'Payout account rejected'
      else if (hasPending.has(row.hostId)) row.blocker = 'Has a pending request — joins the next one'
    }
  }

  const hosts = [...byHost.values()].sort((a, b) => b.amount - a.amount)
  return {
    total: hosts.reduce((s, h) => s + h.amount, 0),
    bookings: eligible.length,
    hosts,
  }
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
  // generic name; the real timestamp columns are `requested_at` and
  // `processed_at`). The two payout figures bucket by DIFFERENT ones on
  // purpose — see the MonthlyRevenue field docs.
  const { data: payoutData, error: payoutError } = await admin
    .from('payout_requests')
    .select('amount, status, requested_at, processed_at')
  if (payoutError) throw new Error(`Failed to load payout_requests: ${payoutError.message}`)
  const payouts = (payoutData ?? []) as {
    amount: number
    status: string
    requested_at: string
    processed_at: string | null
  }[]

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
      payoutsRequestedPending: 0,
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
    if (p.status === 'paid') {
      // Settled money belongs to the month it actually settled in.
      // `mark_payout_paid` always stamps processed_at, so the fallback should
      // be unreachable — it exists so a row hand-fixed in the SQL editor
      // still lands somewhere rather than silently vanishing from the report.
      const row = byMonth.get(monthKey(p.processed_at ?? p.requested_at))
      if (row) row.payoutsPaid += p.amount
    }
    if (p.status === 'pending') {
      // Still-open requests have no processed_at; requested_at is the only
      // date they have.
      const row = byMonth.get(monthKey(p.requested_at))
      if (row) row.payoutsRequestedPending += p.amount
    }
  }

  return lastNMonthKeys(months).map((key) => byMonth.get(key)!)
}

interface InFlightBookingRow {
  booking_ref: string
  pickup_date: string
  return_date: string
  status: string
  payment_status: string
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
      // payment_status is selected deliberately: this list is NOT filtered on
      // it (an unpaid pending booking is genuinely in flight and an admin needs
      // to see it), so the row has to carry it or the money column reads as
      // charged when it isn't.
      `booking_ref, pickup_date, return_date, status, payment_status, total_amount,
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
    paymentStatus: b.payment_status,
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
