import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { BadgeCheck, Star, Clock, MapPin, MessageCircle, ChevronRight, Camera } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getHostProfile } from '@/lib/hosts'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { ListingCard } from '@/components/shared/ListingCard'
import type { Listing, Profile, Review } from '@/types'
import type { Metadata } from 'next'

interface HostView {
  name: string
  avatarUrl: string | null
  verified: boolean
  city: string | null
  bio: string | null
  rating: number | null
  reviewCount: number
  responseTime: string
  since: string
  listings: Listing[]
  reviews: { id: string; reviewer: string; rating: number; date: string; text: string }[]
}

const MOCK_HOST: HostView = {
  name: 'Carlo Santos',
  avatarUrl: null,
  verified: true,
  city: 'Makati, Metro Manila',
  bio: 'Professional photographer and videographer based in Makati. I rent out my personal gear — all well-maintained and always packed with everything you need. Quick responses, smooth handoffs.',
  rating: 4.97,
  reviewCount: 84,
  responseTime: '< 1 hour',
  since: 'March 4, 2023',
  listings: MOCK_LISTINGS.slice(0, 3),
  reviews: [
    { id: 'rv1', reviewer: 'Trish M.', rating: 5, date: 'June 2026', text: 'Super smooth transaction. Gear was in perfect condition and Carlo even threw in extra batteries. Will rent again!' },
    { id: 'rv2', reviewer: 'John C.', rating: 5, date: 'May 2026', text: 'Very responsive host. Clear pickup instructions. The A7 IV is a beast — so happy I could afford to rent it.' },
    { id: 'rv3', reviewer: 'Ana G.', rating: 5, date: 'April 2026', text: 'Professional, punctual, and the gear came in a hard case with everything included. 10/10 experience.' },
  ],
}

function toView(profile: Profile, listings: Listing[], reviews: Review[], city: string | null): HostView {
  const monthYear = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  const fullDate = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
  return {
    name: profile.full_name,
    avatarUrl: profile.avatar_url,
    verified: profile.is_verified,
    city,
    bio: profile.bio,
    rating: profile.host_rating,
    reviewCount: profile.host_review_count,
    responseTime: profile.response_time_hours
      ? `< ${profile.response_time_hours} hour${profile.response_time_hours > 1 ? 's' : ''}`
      : 'Within a day',
    // Exact date the host posted their first listing. `listings` comes back
    // ordered created_at desc, so the last row is the earliest — no extra
    // query. Note RLS only exposes active, published listings, so a host whose
    // genuine first listing is paused or pending review shows their earliest
    // *visible* one. Falls back to the account's own creation date when the
    // host has no visible listings at all.
    since: fullDate(listings[listings.length - 1]?.created_at ?? profile.created_at),
    listings,
    reviews: reviews.map((r) => ({
      id: r.id,
      reviewer: r.reviewer?.full_name ?? 'Rentivo user',
      rating: r.rating,
      date: monthYear(r.created_at),
      text: r.comment,
    })),
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  if (!isSupabaseConfigured()) return { title: `${MOCK_HOST.name} — Rentivo Host` }
  const data = await getHostProfile(id)
  return { title: data ? `${data.profile.full_name} — Rentivo Host` : 'Host Not Found — Rentivo' }
}

export default async function HostProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let host: HostView
  if (isSupabaseConfigured()) {
    const data = await getHostProfile(id)
    if (!data) notFound()
    host = toView(data.profile, data.listings, data.reviews, data.city)
  } else {
    host = MOCK_HOST
  }

  const initial = host.name.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/" className="hover:text-[#003049] transition-colors">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-gray-600">{host.name}</span>
        </nav>

        {/* Host card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {/* Avatar */}
            <div className="relative shrink-0">
              {host.avatarUrl ? (
                <div className="relative w-24 h-24 rounded-full overflow-hidden">
                  <Image src={host.avatarUrl} alt={host.name} fill className="object-cover" sizes="96px" />
                </div>
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#003049] to-blue-400 flex items-center justify-center text-4xl font-black text-white">
                  {initial}
                </div>
              )}
              {host.verified && (
                <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-[#003049] rounded-full flex items-center justify-center border-2 border-white">
                  <BadgeCheck className="w-4 h-4 text-white" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-[#111827]">{host.name}</h1>
                {host.verified && (
                  <span className="flex items-center gap-1 text-xs font-bold bg-blue-50 text-[#003049] px-3 py-1 rounded-full">
                    <BadgeCheck className="w-3.5 h-3.5" /> Verified Host
                  </span>
                )}
              </div>
              {host.city && (
                <div className="flex items-center gap-1.5 mt-1 text-gray-500 text-sm">
                  <MapPin className="w-3.5 h-3.5" /> {host.city}
                </div>
              )}
              <div className="flex flex-wrap gap-5 mt-4 text-sm">
                <div>
                  <p className="font-bold text-[#111827]">{host.rating != null ? `${host.rating} ⭐` : 'New'}</p>
                  <p className="text-xs text-gray-400">{host.reviewCount} review{host.reviewCount === 1 ? '' : 's'}</p>
                </div>
                <div>
                  <p className="font-bold text-[#111827]">{host.responseTime}</p>
                  <p className="text-xs text-gray-400">Avg. response</p>
                </div>
                <div>
                  <p className="font-bold text-[#111827]">{host.listings.length}</p>
                  <p className="text-xs text-gray-400">Listing{host.listings.length === 1 ? '' : 's'}</p>
                </div>
                <div>
                  <p className="font-bold text-[#111827]">{host.since}</p>
                  <p className="text-xs text-gray-400">Hosting since</p>
                </div>
              </div>
            </div>

            {/* CTA */}
            <Link
              href="/dashboard/messages"
              className="flex items-center gap-2 bg-[#003049] hover:bg-[#002438] text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors shrink-0"
            >
              <MessageCircle className="w-4 h-4" /> Message
            </Link>
          </div>

          {/* Bio */}
          {host.bio && (
            <p className="text-gray-600 text-sm leading-relaxed mt-6 pt-6 border-t border-gray-100">
              {host.bio}
            </p>
          )}

          {/* Trust badges */}
          <div className="flex flex-wrap gap-3 mt-5">
            {[
              ...(host.verified
                ? [
                    { icon: BadgeCheck, label: 'Government ID Verified' },
                    { icon: BadgeCheck, label: 'Selfie Verified' },
                  ]
                : []),
              ...(host.rating != null && host.rating >= 4.8
                ? [{ icon: Star, label: 'Top Rated Host' }]
                : []),
              { icon: Clock, label: 'Fast Responder' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
                <Icon className="w-3.5 h-3.5 text-[#22C55E]" /> {label}
              </div>
            ))}
          </div>
        </div>

        {/* Listings */}
        <div>
          <h2 className="text-lg font-bold text-[#111827] mb-4">{host.name}&apos;s Listings</h2>
          {host.listings.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
              <Camera className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No active listings right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {host.listings.map(l => <ListingCard key={l.id} listing={l} />)}
            </div>
          )}
        </div>

        {/* Reviews */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#111827]">Reviews ({host.reviewCount})</h2>
            {host.rating != null && (
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                <span className="font-bold text-[#111827]">{host.rating}</span>
              </div>
            )}
          </div>

          {host.reviews.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No reviews yet.</p>
          ) : (
            <div className="space-y-5">
              {host.reviews.map(r => (
                <div key={r.id} className="pb-5 border-b border-gray-50 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                        {r.reviewer[0]}
                      </div>
                      <span className="text-sm font-semibold text-[#111827]">{r.reviewer}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex">
                        {Array.from({ length: r.rating }).map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">{r.date}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{r.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
