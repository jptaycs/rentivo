import { Star } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

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
}

export function ReviewsList({ rating, reviewCount }: ReviewsListProps) {
  return (
    <div>
      {/* Summary */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-1">
          <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
          <span className="text-2xl font-bold text-[#111827]">{rating?.toFixed(2) ?? '—'}</span>
        </div>
        <span className="text-gray-500">·</span>
        <span className="text-gray-600 font-medium">{reviewCount} reviews</span>
      </div>

      {/* Rating bars */}
      <div className="grid grid-cols-2 gap-2 mb-8">
        {[
          { label: 'Accuracy', val: 4.9 },
          { label: 'Communication', val: 5.0 },
          { label: 'Condition', val: 4.8 },
          { label: 'Value', val: 4.7 },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-sm text-gray-600 w-28 shrink-0">{item.label}</span>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#111827] rounded-full"
                style={{ width: `${(item.val / 5) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-[#111827] w-6 text-right">{item.val}</span>
          </div>
        ))}
      </div>

      {/* Reviews */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {MOCK_REVIEWS.map((review) => (
          <div key={review.id}>
            <div className="flex items-center gap-3 mb-2">
              <Avatar className="w-9 h-9">
                <AvatarFallback className="bg-gray-200 text-gray-600 text-xs font-semibold">
                  {review.reviewer.split(' ').map((n) => n[0]).join('')}
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
