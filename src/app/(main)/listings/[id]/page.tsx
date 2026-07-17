import { notFound } from 'next/navigation'
import { getListing, getListingReviews } from '@/lib/listings'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { ViewTracker } from '@/components/listings/ViewTracker'
import { PhotoGallery } from '@/components/listings/PhotoGallery'
import { PickupMap } from '@/components/listings/PickupMap'
import { BookingPanel } from '@/components/listings/BookingPanel'
import { HostCard } from '@/components/listings/HostCard'
import { ReviewsList } from '@/components/listings/ReviewsList'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  BadgeCheck, Zap, MapPin, CheckCircle2, Shield, XCircle, Info,
} from 'lucide-react'
import Link from 'next/link'

interface ListingPageProps {
  params: Promise<{ id: string }>
}

export default async function ListingPage({ params }: ListingPageProps) {
  const { id } = await params
  const listing = await getListing(id)

  if (!listing) notFound()

  const reviews = isSupabaseConfigured() ? await getListingReviews(listing.id) : undefined

  const CONDITION_LABELS: Record<string, string> = {
    mint: 'Mint condition',
    excellent: 'Excellent condition',
    good: 'Good condition',
    fair: 'Fair condition',
  }

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <ViewTracker listing={listing} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/" className="hover:text-[#003049]">Home</Link>
          <span>/</span>
          <Link href="/search" className="hover:text-[#003049]">Search</Link>
          <span>/</span>
          <span className="text-[#111827] font-medium truncate">{listing.title}</span>
        </nav>

        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] leading-tight">
              {listing.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {listing.host?.is_verified && (
                <span className="flex items-center gap-1 text-[#003049] text-sm font-medium">
                  <BadgeCheck className="w-4 h-4" /> Verified Host
                </span>
              )}
              {listing.is_instant_book && (
                <span className="flex items-center gap-1 text-[#FDF0D5] text-sm font-medium">
                  <Zap className="w-4 h-4" /> Instant Book
                </span>
              )}
              <span className="flex items-center gap-1 text-gray-500 text-sm">
                <MapPin className="w-4 h-4" /> {listing.city}, {listing.province}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary" className="text-xs">{CONDITION_LABELS[listing.condition]}</Badge>
            <Badge variant="secondary" className="text-xs capitalize">{listing.category.replace('_', ' ')}</Badge>
          </div>
        </div>

        {/* Photo Gallery */}
        <PhotoGallery images={listing.images} title={listing.title} />

        {/* Main content + sticky panel */}
        <div className="mt-8 flex flex-col lg:flex-row gap-10">

          {/* Left — details */}
          <div className="flex-1 min-w-0 space-y-10">

            {/* Description */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-3">About this equipment</h2>
              <p className="text-gray-600 leading-relaxed">{listing.description}</p>
            </section>

            <Separator />

            {/* Specs */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-4">Specifications</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: 'Brand', value: listing.brand },
                  { label: 'Model', value: listing.model },
                  { label: 'Category', value: listing.category.charAt(0).toUpperCase() + listing.category.slice(1) },
                  { label: 'Condition', value: CONDITION_LABELS[listing.condition] },
                  { label: 'Location', value: `${listing.city}, ${listing.province}` },
                  { label: 'Security Deposit', value: `₱${listing.security_deposit.toLocaleString()}` },
                ].map((s) => (
                  <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
                    <dt className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{s.label}</dt>
                    <dd className="text-sm font-semibold text-[#111827]">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <Separator />

            {/* Pricing tiers */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-4">Rental Pricing</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#003049] text-white rounded-2xl p-5">
                  <p className="text-blue-200 text-xs font-bold uppercase tracking-wider mb-1">Daily</p>
                  <p className="text-3xl font-bold">₱{listing.daily_price.toLocaleString()}</p>
                </div>
                {listing.weekly_price && (
                  <div className="bg-white border border-gray-100 rounded-2xl p-5">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Weekly</p>
                    <p className="text-3xl font-bold text-[#111827]">₱{listing.weekly_price.toLocaleString()}</p>
                    <p className="text-xs text-[#22C55E] font-semibold mt-1">
                      Save ₱{(listing.daily_price * 7 - listing.weekly_price).toLocaleString()}
                    </p>
                  </div>
                )}
                {listing.monthly_price && (
                  <div className="bg-white border border-gray-100 rounded-2xl p-5">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Monthly</p>
                    <p className="text-3xl font-bold text-[#111827]">₱{listing.monthly_price.toLocaleString()}</p>
                    <p className="text-xs text-[#22C55E] font-semibold mt-1">
                      Save ₱{(listing.daily_price * 30 - listing.monthly_price).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* What's Included */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-4">What's Included</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {listing.accessories.map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            {/* Pickup Location */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-4">Pickup Location</h2>
              <PickupMap city={listing.city} province={listing.province} />
            </section>

            <Separator />

            {/* Rental Rules */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-4">Rental Rules</h2>
              <div className="space-y-3">
                {[
                  { icon: CheckCircle2, color: 'text-[#22C55E]', text: 'Valid government ID required for pickup' },
                  { icon: CheckCircle2, color: 'text-[#22C55E]', text: 'Equipment must be returned in the same condition' },
                  { icon: CheckCircle2, color: 'text-[#22C55E]', text: 'Renter is responsible for loss or damage' },
                  { icon: XCircle, color: 'text-red-400', text: 'No sub-renting or transferring to third parties' },
                  { icon: Info, color: 'text-[#003049]', text: 'Late returns charged at 1.5x the daily rate per day' },
                ].map((rule, i) => {
                  const Icon = rule.icon
                  return (
                    <div key={i} className="flex items-start gap-3 text-sm text-gray-700">
                      <Icon className={`w-4 h-4 ${rule.color} mt-0.5 shrink-0`} />
                      {rule.text}
                    </div>
                  )
                })}
              </div>
            </section>

            <Separator />

            {/* Trust & Safety */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-4">Trust & Safety</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: Shield, title: 'Equipment Protection', desc: 'Covered for accidental damage up to ₱50,000' },
                  { icon: BadgeCheck, title: 'Verified Profiles', desc: 'ID and selfie verified by Rentivo' },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.title} className="flex gap-3 p-4 bg-white rounded-xl border border-gray-100">
                      <Icon className="w-5 h-5 text-[#003049] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-[#111827]">{item.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <Separator />

            {/* Reviews */}
            <section>
              <h2 className="text-xl font-bold text-[#111827] mb-6">Reviews</h2>
              <ReviewsList rating={listing.rating} reviewCount={listing.review_count} reviews={reviews} />
            </section>

            <Separator />

            {/* Host */}
            {listing.host && (
              <section>
                <h2 className="text-xl font-bold text-[#111827] mb-4">Your Host</h2>
                <HostCard host={listing.host} />
              </section>
            )}
          </div>

          {/* Right — sticky booking panel */}
          <div className="lg:w-[360px] shrink-0">
            <div className="sticky top-24">
              <BookingPanel listing={listing} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
