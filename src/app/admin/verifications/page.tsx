import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { VerificationReviewActions } from '@/components/admin/VerificationReviewActions'

export const dynamic = 'force-dynamic'

interface VerificationRow {
  id: string
  user_id: string
  id_doc_path: string
  selfie_path: string
  status: 'pending' | 'approved' | 'rejected'
  reviewer_notes: string | null
  auto_check_failed: boolean
  auto_check_detail: string | null
  created_at: string
  reviewed_at: string | null
  profiles: { full_name: string; is_host: boolean; is_verified: boolean; created_at: string } | null
}

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const

export default async function AdminVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: rawStatus } = await searchParams
  const status = FILTERS.includes(rawStatus as (typeof FILTERS)[number])
    ? (rawStatus as (typeof FILTERS)[number])
    : 'pending'

  const admin = createAdminClient()
  let query = admin
    .from('verification_requests')
    .select(
      'id, user_id, id_doc_path, selfie_path, status, reviewer_notes, auto_check_failed, auto_check_detail, created_at, reviewed_at, profiles!verification_requests_user_id_fkey(full_name, is_host, is_verified, created_at)'
    )
    .order('created_at', { ascending: false })
    .limit(50)
  if (status !== 'all') query = query.eq('status', status)
  const { data } = await query
  const requests = (data ?? []) as unknown as VerificationRow[]

  // One signed-URL batch for every document on the page (10 min expiry).
  const paths = requests.flatMap((r) => [r.id_doc_path, r.selfie_path])
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await admin.storage.from('verification-docs').createSignedUrls(paths, 600)
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Identity Verifications</h1>
      <div className="mb-6 flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/verifications?status=${f}`}
            className={`rounded-full px-4 py-1.5 text-sm capitalize ${
              f === status ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      {requests.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          No {status === 'all' ? '' : status} verification requests.
        </p>
      )}

      <div className="space-y-6">
        {requests.map((r) => (
          <div key={r.id} className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-900">{r.profiles?.full_name || 'Unknown user'}</p>
                <p className="text-xs text-gray-500">
                  {r.profiles?.is_host ? 'Host' : 'Renter'} · joined{' '}
                  {r.profiles ? new Date(r.profiles.created_at).toLocaleDateString('en-PH') : '—'} ·
                  submitted {new Date(r.created_at).toLocaleDateString('en-PH')}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                  r.status === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : r.status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                }`}
              >
                {r.status}
              </span>
            </div>

            {r.auto_check_failed && (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Automated check failed — review this one carefully.</p>
                  <p className="text-xs">
                    The submitter&apos;s browser could not confirm a face on
                    {r.auto_check_detail ? ` ${r.auto_check_detail}` : ' one or both images'}, and submitted anyway.
                    This flag is reported by the browser and is advisory only.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['ID Document', r.id_doc_path],
                  ['Selfie', r.selfie_path],
                ] as const
              ).map(([label, path]) => (
                <div key={label}>
                  <p className="mb-1 text-xs font-semibold text-gray-500">{label}</p>
                  {urlByPath.get(path) ? (
                    // Signed Supabase-storage URL; plain <img> matches how private
                    // signed content is rendered elsewhere (QR images), bypassing
                    // next/image remotePatterns.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urlByPath.get(path)}
                      alt={label}
                      className="max-h-96 w-full rounded-xl border border-gray-100 object-contain"
                    />
                  ) : (
                    <p className="rounded-xl bg-gray-50 p-4 text-xs text-gray-400">
                      Document unavailable.
                    </p>
                  )}
                </div>
              ))}
            </div>

            {r.reviewer_notes && (
              <p className="mt-4 text-xs text-gray-500">Notes: {r.reviewer_notes}</p>
            )}
            {r.status === 'pending' && <VerificationReviewActions requestId={r.id} />}
          </div>
        ))}
      </div>
    </div>
  )
}
