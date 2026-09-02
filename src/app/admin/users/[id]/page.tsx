import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkDeletionEligibility } from '@/lib/account-deletion'
import { LISTING_COLUMNS } from '@/lib/listing-columns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserActions } from './UserActions'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`
const mask = (number: string) => `•••• ${number.slice(-4)}`

interface ProfileRow {
  id: string
  full_name: string
  avatar_url: string | null
  bio: string | null
  city: string | null
  is_host: boolean
  is_verified: boolean
  suspended_at: string | null
  created_at: string
}

interface ListingRow {
  id: string
  title: string
  brand: string
  model: string
  is_active: boolean
  is_draft: boolean
  daily_price: number
  created_at: string
}

interface BookingRow {
  id: string
  booking_ref: string
  pickup_date: string
  return_date: string
  status: string
  payment_status: string
  total_amount: number
  listing: { title: string } | null
}

interface ReviewRow {
  id: string
  rating: number
  comment: string
  created_at: string
  reviewer: { full_name: string } | null
}

interface PayoutAccountRow {
  method: string
  account_number: string
  account_name: string
  status: string
}

interface AdminActionRow {
  id: string
  admin_email: string
  action: string
  detail: { reason?: string; ban_failed?: boolean } | Record<string, unknown> | null
  created_at: string
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminClient()

  const { data: profileData } = await admin
    .from('profiles')
    .select('id, full_name, avatar_url, bio, city, is_host, is_verified, suspended_at, created_at')
    .eq('id', id)
    .maybeSingle()
  if (!profileData) notFound()
  const profile = profileData as ProfileRow

  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const email = authUser?.user?.email ?? '—'
  const isDeleted = Boolean(authUser?.user?.deleted_at)

  const [
    { data: listingsData },
    { data: bookingsAsHostData },
    { data: bookingsAsRenterData },
    { data: reviewsData },
    { data: payoutAccountData },
    { data: adminActionsData },
    eligibility,
  ] = await Promise.all([
    admin
      .from('listings')
      .select(LISTING_COLUMNS)
      .eq('host_id', id)
      .order('created_at', { ascending: false }),
    admin
      .from('bookings')
      .select(
        'id, booking_ref, pickup_date, return_date, status, payment_status, total_amount, listing:listings!bookings_listing_id_fkey(title)'
      )
      .eq('host_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('bookings')
      .select(
        'id, booking_ref, pickup_date, return_date, status, payment_status, total_amount, listing:listings!bookings_listing_id_fkey(title)'
      )
      .eq('renter_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('reviews')
      .select('id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(full_name)')
      .eq('reviewee_id', id)
      .order('created_at', { ascending: false }),
    admin
      .from('payout_accounts')
      .select('method, account_number, account_name, status')
      .eq('user_id', id)
      .maybeSingle(),
    admin
      .from('admin_actions')
      .select('id, admin_email, action, detail, created_at')
      .eq('target_user_id', id)
      .order('created_at', { ascending: false }),
    checkDeletionEligibility(id),
  ])

  const listings = (listingsData ?? []) as unknown as ListingRow[]
  const bookingsAsHost = (bookingsAsHostData ?? []) as unknown as BookingRow[]
  const bookingsAsRenter = (bookingsAsRenterData ?? []) as unknown as BookingRow[]
  const reviews = (reviewsData ?? []) as unknown as ReviewRow[]
  const payoutAccount = payoutAccountData as PayoutAccountRow | null
  const adminActions = (adminActionsData ?? []) as AdminActionRow[]

  // The suspension reason: profiles.suspension_reason was dropped in migration
  // 047 (anon could read it via raw PostgREST). It lives ONLY in the latest
  // `admin_actions` row for `action = 'suspend'` — and a single logical
  // suspension can produce TWO rows (a `ban_failed: true` partial-failure row,
  // then the successful retry), so take the newest one, not "the" one.
  const latestSuspendAction = adminActions.find((a) => a.action === 'suspend')
  const suspensionReason =
    latestSuspendAction && typeof latestSuspendAction.detail === 'object' && latestSuspendAction.detail
      ? ((latestSuspendAction.detail as { reason?: string }).reason ?? null)
      : null

  const bookingStatusColor = (status: string) =>
    status === 'completed'
      ? 'bg-green-100 text-green-800'
      : status === 'cancelled'
        ? 'bg-red-100 text-red-800'
        : status === 'active'
          ? 'bg-blue-50 text-[#003049]'
          : 'bg-amber-100 text-amber-800'

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="text-sm text-gray-500 hover:underline">
        ← Back to users
      </Link>

      {/* Profile */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile.avatar_url ?? ''} />
              <AvatarFallback className="bg-[#003049] text-white font-bold">
                {(profile.full_name || '?')
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{profile.full_name || 'Unnamed user'}</h1>
              <p className="text-sm text-gray-500">{email}</p>
              <p className="text-xs text-gray-400">
                {profile.city || 'No city set'} · joined {new Date(profile.created_at).toLocaleDateString('en-PH')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                profile.is_host ? 'bg-blue-50 text-[#003049]' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {profile.is_host ? 'Host' : 'Renter'}
            </span>
            {profile.is_verified && (
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                Verified
              </span>
            )}
            {isDeleted && (
              <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700">
                Deleted account
              </span>
            )}
          </div>
        </div>

        {profile.bio && <p className="mt-4 text-sm text-gray-600">{profile.bio}</p>}

        {profile.suspended_at && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Suspended {new Date(profile.suspended_at).toLocaleString('en-PH')}</p>
            <p className="mt-1">
              Reason: {suspensionReason ?? 'No reason found in the audit log (unexpected — check admin_actions).'}
            </p>
          </div>
        )}
      </div>

      <UserActions
        userId={id}
        isSuspended={Boolean(profile.suspended_at)}
        eligible={eligibility.ok}
        reason={eligibility.ok ? null : eligibility.reason}
        blocking={eligibility.ok ? { bookings: [], pendingPayouts: 0 } : eligibility.blocking}
      />

      {/* Listings */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Listings ({listings.length})</h2>
        {listings.length === 0 ? (
          <p className="text-sm text-gray-500">No listings.</p>
        ) : (
          <div className="space-y-2">
            {listings.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-50 py-2 text-sm">
                <span className="font-medium text-gray-900">
                  {l.brand} {l.model} — {l.title}
                </span>
                <div className="flex gap-2">
                  {l.is_draft && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      Draft
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      l.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {l.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-xs text-gray-400">{peso(l.daily_price)}/day</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bookings as host */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Bookings as host ({bookingsAsHost.length})</h2>
        <BookingsTable bookings={bookingsAsHost} bookingStatusColor={bookingStatusColor} />
      </div>

      {/* Bookings as renter */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Bookings as renter ({bookingsAsRenter.length})</h2>
        <BookingsTable bookings={bookingsAsRenter} bookingStatusColor={bookingStatusColor} />
      </div>

      {/* Reviews */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Reviews received ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-gray-500">No reviews yet.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="border-b border-gray-50 pb-3 text-sm">
                <p className="font-semibold text-gray-900">
                  {'⭐'.repeat(r.rating)} <span className="ml-2 text-xs font-normal text-gray-400">by {r.reviewer?.full_name ?? 'Unknown'}</span>
                </p>
                <p className="mt-1 text-gray-600">{r.comment}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payout account */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Payout account</h2>
        {payoutAccount ? (
          <p className="text-sm text-gray-600">
            {payoutAccount.method} · {payoutAccount.account_name} · {mask(payoutAccount.account_number)}{' '}
            <span
              className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                payoutAccount.status === 'verified'
                  ? 'bg-green-100 text-green-800'
                  : payoutAccount.status === 'rejected'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-800'
              }`}
            >
              {payoutAccount.status}
            </span>
          </p>
        ) : (
          <p className="text-sm text-gray-500">No payout account on file.</p>
        )}
      </div>

      {/* Admin action history */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Admin action history ({adminActions.length})</h2>
        {adminActions.length === 0 ? (
          <p className="text-sm text-gray-500">No admin actions on this account.</p>
        ) : (
          <div className="space-y-2">
            {adminActions.map((a) => (
              <div key={a.id} className="border-b border-gray-50 py-2 text-sm">
                <p className="font-semibold capitalize text-gray-900">
                  {a.action}
                  {a.detail && typeof a.detail === 'object' && 'ban_failed' in a.detail && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                      partial failure
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  {a.admin_email} · {new Date(a.created_at).toLocaleString('en-PH')}
                </p>
                {a.detail && typeof a.detail === 'object' && 'reason' in a.detail && (a.detail as { reason?: string }).reason && (
                  <p className="mt-1 text-xs text-gray-600">Reason: {(a.detail as { reason?: string }).reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BookingsTable({
  bookings,
  bookingStatusColor,
}: {
  bookings: BookingRow[]
  bookingStatusColor: (status: string) => string
}) {
  if (bookings.length === 0) {
    return <p className="text-sm text-gray-500">No bookings.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500">
            <th className="px-2 py-2">Ref</th>
            <th className="px-2 py-2">Item</th>
            <th className="px-2 py-2">Dates</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Payment</th>
            <th className="px-2 py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-b border-gray-50">
              <td className="px-2 py-2 font-mono text-xs">{b.booking_ref}</td>
              <td className="px-2 py-2">{b.listing?.title ?? '—'}</td>
              <td className="px-2 py-2 text-xs text-gray-500">
                {new Date(b.pickup_date).toLocaleDateString('en-PH')} –{' '}
                {new Date(b.return_date).toLocaleDateString('en-PH')}
              </td>
              <td className="px-2 py-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${bookingStatusColor(b.status)}`}>
                  {b.status}
                </span>
              </td>
              <td className="px-2 py-2 text-xs capitalize text-gray-600">{b.payment_status}</td>
              <td className="px-2 py-2 font-semibold">{peso(b.total_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
