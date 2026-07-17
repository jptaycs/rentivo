import { Star } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { Review } from '@/types'

const MOCK_REVIEWS = [
  {
    id: 'r1',
    reviewer: 'Maria S.',
    rating: 5,
    date: 'May 2026',
    comment: 'Camera was in perfect condition, exactly as described. Host was very responsive and pickup was smooth. Will definitely rent again!',
  },
  {
    id: 'r2',
    reviewer: 'John D.',
    rating: 5,
    date: 'April 2026',
    comment: 'Great experience! The A7 IV delivered stunning results for our product shoot. Easy transaction from start to finish.',
  },
  {
    id: 'r3',
    reviewer: 'Trish M.',
    rating: 4,
    date: 'March 2026',
    comment: 'Really good condition. One of the batteries didn\'t hold charge well but it wasn\'t a dealbreaker. Would rent again.',
  },
]

interface ReviewsListProps {
  rating: number | null
  reviewCount: number
  /** Live reviews from the database; when undefined the mock set is shown */
  reviews?: Review[]
}

interface ReviewView {
  id: string
  reviewer: string
  rating: number
  date: string
  comment: string
}

export function ReviewsList({ rating, reviewCount, reviews }: ReviewsListProps) {
  const items: ReviewView[] =
    reviews !== undefined
      ? reviews.map((r) => ({
          id: r.id,
          reviewer: r.reviewer?.full_name ?? 'Rentivo user',
          rating: r.rating,
          date: new Date(r.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
          comment: r.comment,
        }))
      : MOCK_REVIEWS

  const avg = rating ?? (items.length > 0 ? items.reduce((s, r) => s + r.rating, 0) / items.length : null)

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4">
        No reviews yet — be the first to rent and review this listing.
      </p>
    )
  }

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-1">
          <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
          <span className="text-2xl font-bold text-[#111827]">{avg?.toFixed(2) ?? '—'}</span>
        </div>
        <span className="text-gray-500">·</span>
        <span className="text-gray-600 font-medium">{reviewCount} review{reviewCount === 1 ? '' : 's'}</span>
      </div>

      {/* Rating bars */}
      {avg != null && (
        <div className="grid grid-cols-2 gap-2 mb-8">
          {['Accuracy', 'Communication', 'Condition', 'Value'].map((label) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-28 shrink-0">{label}</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#111827] rounded-full"
                  style={{ width: `${(avg / 5) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-[#111827] w-6 text-right">{avg.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reviews */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {items.map((review) => (
          <div key={review.id}>
            <div className="flex items-center gap-3 mb-2">
              <Avatar className="w-9 h-9">
                <AvatarFallback className="bg-gray-200 text-gray-600 text-xs font-semibold">
                  {review.reviewer.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-semibold text-[#111827]">{review.reviewer}</p>
                <div className="flex items-center gap-1">
                  {Array.from({ length: review.rating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
                  ))}
                  <span className="text-xs text-gray-400 ml-1">{review.date}</span>
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{review.comment}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
