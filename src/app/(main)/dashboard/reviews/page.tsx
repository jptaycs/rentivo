'use client'

import { Star, Loader2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useMyReviews } from '@/hooks/useMyReviews'
import { isSupabaseConfigured } from '@/lib/supabase/config'

const MOCK_REVIEWS = [
  { id: 'r1', reviewer: 'Maria Santos', initial: 'M', rating: 5, date: '2026-06-28', equipment: 'Sony A7 IV', comment: 'Camera was in perfect condition, exactly as described. Host was very responsive and pickup was smooth. Will definitely rent again!' },
  { id: 'r2', reviewer: 'John dela Cruz', initial: 'J', rating: 5, date: '2026-06-22', equipment: 'Sony FX3', comment: 'Great experience! The FX3 delivered stunning results for our corporate video. Easy transaction from start to finish.' },
  { id: 'r3', reviewer: 'Trish Mendoza', initial: 'T', rating: 4, date: '2026-06-15', equipment: 'Sony A7 IV', comment: 'Really good condition. One battery didn\'t hold charge well, but host sent a replacement quickly. Great communication.' },
  { id: 'r4', reviewer: 'Ryan Lim', initial: 'R', rating: 5, date: '2026-06-08', equipment: 'iPhone 16 Pro Max', comment: 'Exactly as described. Phone was clean, fully charged, and the case was included. Super smooth transaction!' },
]

export default function ReviewsPage() {
  const live = isSupabaseConfigured()
  const { reviews: liveReviews, loading } = useMyReviews()

  const reviews = live
    ? liveReviews.map((r) => ({
        id: r.id,
        reviewer: r.reviewer?.full_name ?? 'Rentivo user',
        initial: (r.reviewer?.full_name ?? '?').charAt(0).toUpperCase(),
        avatarUrl: r.reviewer?.avatar_url ?? null,
        rating: r.rating,
        date: r.created_at,
        equipment: r.listing?.title ?? null,
        comment: r.comment,
      }))
    : MOCK_REVIEWS

  const avg = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2) : '—'

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-[#111827]">Reviews</h1>

      {live && loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-2xl border border-gray-100">
          <Star className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No reviews yet</p>
          <p className="text-sm mt-1">Reviews from completed rentals will show up here.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-8">
            <div className="text-center">
              <p className="text-5xl font-bold text-[#111827]">{avg}</p>
              <div className="flex justify-center gap-0.5 mt-2">
                {[1,2,3,4,5].map(i => (
                  <Star key={i} className={`w-4 h-4 ${i <= Math.round(Number(avg)) ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">{reviews.length} review{reviews.length > 1 ? 's' : ''}</p>
            </div>
            <div className="flex-1 space-y-2">
              {[5,4,3,2,1].map(star => {
                const count = reviews.filter(r => r.rating === star).length
                const pct = Math.round((count / reviews.length) * 100)
                return (
                  <div key={star} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-4">{star}</span>
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-6 text-right">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Reviews list */}
          <div className="space-y-4">
            {reviews.map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-9 h-9">
                      {/* avatar_url was already fetched via PROFILE_COLUMNS and
                          then discarded — only the fallback was rendered. */}
                      <AvatarImage src={'avatarUrl' in r ? r.avatarUrl ?? '' : ''} alt={r.reviewer} />
                      <AvatarFallback className="bg-[#003049]/10 text-[#003049] text-xs font-bold">{r.initial}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-[#111827] text-sm">{r.reviewer}</p>
                      <p className="text-xs text-gray-400">
                        {r.equipment ? `${r.equipment} · ` : ''}
                        {new Date(r.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    {[1,2,3,4,5].map(i => (
                      <Star key={i} className={`w-3.5 h-3.5 ${i <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
                    ))}
                  </div>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{r.comment}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
