import { Star } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const REVIEWS = [
  { id: 'r1', reviewer: 'Maria Santos', initial: 'M', rating: 5, date: '2026-06-28', equipment: 'Sony A7 IV', comment: 'Camera was in perfect condition, exactly as described. Host was very responsive and pickup was smooth. Will definitely rent again!' },
  { id: 'r2', reviewer: 'John dela Cruz', initial: 'J', rating: 5, date: '2026-06-22', equipment: 'Sony FX3', comment: 'Great experience! The FX3 delivered stunning results for our corporate video. Easy transaction from start to finish.' },
  { id: 'r3', reviewer: 'Trish Mendoza', initial: 'T', rating: 4, date: '2026-06-15', equipment: 'Sony A7 IV', comment: 'Really good condition. One battery didn\'t hold charge well, but host sent a replacement quickly. Great communication.' },
  { id: 'r4', reviewer: 'Ryan Lim', initial: 'R', rating: 5, date: '2026-06-08', equipment: 'iPhone 16 Pro Max', comment: 'Exactly as described. Phone was clean, fully charged, and the case was included. Super smooth transaction!' },
]

const AVG = (REVIEWS.reduce((s, r) => s + r.rating, 0) / REVIEWS.length).toFixed(2)

export default function ReviewsPage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-[#111827]">Reviews</h1>

      {/* Summary */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-8">
        <div className="text-center">
          <p className="text-5xl font-bold text-[#111827]">{AVG}</p>
          <div className="flex justify-center gap-0.5 mt-2">
            {[1,2,3,4,5].map(i => (
              <Star key={i} className={`w-4 h-4 ${i <= Math.round(Number(AVG)) ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">{REVIEWS.length} reviews</p>
        </div>
        <div className="flex-1 space-y-2">
          {[5,4,3,2,1].map(star => {
            const count = REVIEWS.filter(r => r.rating === star).length
            const pct = Math.round((count / REVIEWS.length) * 100)
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
        {REVIEWS.map((r) => (
          <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="bg-[#2563EB]/10 text-[#2563EB] text-xs font-bold">{r.initial}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-[#111827] text-sm">{r.reviewer}</p>
                  <p className="text-xs text-gray-400">{r.equipment} · {new Date(r.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
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
    </div>
  )
}
