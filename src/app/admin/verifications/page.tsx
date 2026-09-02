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

const CHECK_CODE_LABEL: Record<string, string> = {
  no_face: 'no face was found',
  too_small: 'the image was too small to check',
  unreadable: 'the image could not be opened',
}

/**
 * `auto_check_detail` is a comma-joined list of `id:<code>` / `selfie:<code>`
 * (a real failed check the submitter overrode) and/or a bare
 * `detector_unavailable` (the on-device model never loaded, so *nothing* ran —
 * not a bypass at all). The banner used to hardcode "could not confirm a
 * face", which is false for `too_small`/`unreadable` (no face check ever ran)
 * and doubly false for a detector-unavailable-only submission, where the user
 * also made no override choice. Branch on the actual codes instead.
 */
function autoCheckSummary(detail: string | null): string {
  const slotFindings: string[] = []
  let detectorUnavailable = false
  for (const part of (detail ?? '').split(',').filter(Boolean)) {
    if (part === 'detector_unavailable') {
      detectorUnavailable = true
      continue
    }
    const [slot, code] = part.split(':')
    const label = CHECK_CODE_LABEL[code]
    if (label && (slot === 'id' || slot === 'selfie')) {
      slotFindings.push(`the ${slot === 'id' ? 'ID' : 'selfie'} (${label})`)
    }
  }

  if (slotFindings.length > 0) {
    return `The submitter's browser flagged ${slotFindings.join(' and ')}, and submitted anyway.`
  }
  if (detectorUnavailable) {
    return "The face-detection check couldn't load in the submitter's browser, so no automated check ran on this submission at all — this isn't a sign of a deliberate bypass."
  }
  return 'An automated check on this submission did not pass. Review the documents carefully.'
}

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
                    {autoCheckSummary(r.auto_check_detail)} This flag is reported by the browser and is advisory
                    only.
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
