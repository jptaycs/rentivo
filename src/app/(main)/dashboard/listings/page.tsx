'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Plus, Star, Zap, Eye, Pencil, Pause, Play, Trash2, BadgeCheck, Loader2, Package, AlertCircle } from 'lucide-react'
import { useMyListings } from '@/hooks/useMyListings'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { isSupabaseConfigured } from '@/lib/supabase/config'

export default function ListingsPage() {
  const live = isSupabaseConfigured()
  const { listings: liveListings, loading, setActive, remove } = useMyListings()
  const listings = live ? liveListings : MOCK_LISTINGS.slice(0, 4)
  const [actingOn, setActingOn] = useState('')
  const [error, setError] = useState('')

  async function toggleActive(id: string, isActive: boolean) {
    setError('')
    setActingOn(id)
    const err = await setActive(id, !isActive)
    if (err) setError(err)
    setActingOn('')
  }

  async function deleteListing(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return
    setError('')
    setActingOn(id)
    const err = await remove(id)
    if (err) setError(err)
    setActingOn('')
  }

  const activeCount = listings.filter((l) => l.is_active && !l.is_draft).length
  const pendingCount = listings.filter((l) => l.is_draft).length

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">My Listings</h1>
          <p className="text-gray-500 text-sm mt-0.5">{activeCount} active listing{activeCount === 1 ? '' : 's'}</p>
        </div>
        <Link
          href="/host/new"
          className="bg-[#003049] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#002438] transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Listing
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {live && loading ? (
        <div className="flex justify-center py-16 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No listings yet</p>
          <Link href="/host/new" className="text-sm text-[#003049] hover:underline mt-2 inline-block">Create your first listing →</Link>
        </div>
      ) : (
        <>
          {pendingCount > 0 && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-6">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {pendingCount === 1 ? 'One listing is' : `${pendingCount} listings are`} waiting on ID verification.
              They go live automatically once an admin approves your ID.
            </div>
          )}
        <div className="space-y-3">
          {listings.map((listing) => (
            <div key={listing.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              <div className="flex gap-4 p-4">
                {/* Thumbnail */}
                <div className="relative w-24 h-20 rounded-xl overflow-hidden shrink-0 bg-gray-100">
                  {listing.images[0] && (
                    <Image
                      src={listing.images[0]}
                      alt={listing.title}
                      fill
                      className="object-cover"
                      sizes="96px"
                    />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 font-medium">{listing.brand}</p>
                      <h3 className="font-bold text-[#111827] text-sm leading-snug truncate">{listing.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{listing.city}, {listing.province}</p>
                    </div>
                    {listing.is_draft ? (
                      <span className="shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Pending review
                      </span>
                    ) : (
                      <span className={`shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                        listing.is_active ? 'bg-green-50 text-[#22C55E]' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${listing.is_active ? 'bg-[#22C55E]' : 'bg-gray-400'}`} />
                        {listing.is_active ? 'Active' : 'Paused'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    <span className="text-sm font-bold text-[#003049]">₱{listing.daily_price.toLocaleString()}/day</span>
                    {listing.rating != null && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        {listing.rating} ({listing.review_count})
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Eye className="w-3 h-3" /> {listing.view_count} views
                    </span>
                    {listing.is_instant_book && (
                      <span className="flex items-center gap-1 text-xs text-[#003049] font-medium">
                        <Zap className="w-3 h-3" /> Instant Book
                      </span>
                    )}
                    {listing.host?.is_verified && (
                      <span className="flex items-center gap-1 text-xs text-[#003049] font-medium">
                        <BadgeCheck className="w-3 h-3" /> Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                <Link
                  href={`/listings/${listing.id}`}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview
                </Link>
                <Link
                  href={`/dashboard/listings/${listing.id}/edit`}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#003049] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
                {live && (
                  <>
                    <button
                      onClick={() => toggleActive(listing.id, listing.is_active)}
                      disabled={actingOn === listing.id}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-amber-600 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors ml-auto disabled:opacity-50"
                    >
                      {actingOn === listing.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : listing.is_active ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      {listing.is_active ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      onClick={() => deleteListing(listing.id, listing.title)}
                      disabled={actingOn === listing.id}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  )
}
