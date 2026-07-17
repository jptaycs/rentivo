'use client'

import { useState } from 'react'
import { Star, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'

interface ReviewModalProps {
  open: boolean
  onClose: () => void
  bookingId: string
  revieweeId: string
  revieweeName: string
  /** Set for renter→host reviews so the listing's rating updates too */
  listingId?: string | null
  onSubmitted: (bookingId: string) => void
}

export function ReviewModal({
  open,
  onClose,
  bookingId,
  revieweeId,
  revieweeName,
  listingId,
  onSubmitted,
}: ReviewModalProps) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (rating === 0 || !comment.trim()) return
    setSubmitting(true)
    setError('')

    if (isSupabaseConfigured()) {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError('You must be signed in to leave a review.')
        setSubmitting(false)
        return
      }
      const { error: insertError } = await supabase.from('reviews').insert({
        booking_id: bookingId,
        reviewer_id: user.id,
        reviewee_id: revieweeId,
        listing_id: listingId ?? null,
        rating,
        comment: comment.trim(),
      })
      if (insertError) {
        setError(
          insertError.code === '23505'
            ? 'You have already reviewed this booking.'
            : insertError.message
        )
        setSubmitting(false)
        return
      }
    }

    setSubmitting(false)
    onSubmitted(bookingId)
    onClose()
    setRating(0)
    setComment('')
  }

  const labels = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review {revieweeName}</DialogTitle>
          <DialogDescription>
            Your review is public and helps keep the Rentivo community trustworthy.
          </DialogDescription>
        </DialogHeader>

        {/* Star picker */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="flex gap-1.5" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHovered(n)}
                className="p-0.5 transition-transform hover:scale-110"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
              >
                <Star
                  className={`w-8 h-8 transition-colors ${
                    n <= (hovered || rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-gray-300'
                  }`}
                />
              </button>
            ))}
          </div>
          <p className="text-xs font-medium text-gray-500 h-4">{labels[hovered || rating]}</p>
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="How was the equipment and the handoff? Was everything as described?"
          className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-[#003049] focus:ring-2 focus:ring-blue-100 resize-none"
        />

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          onClick={submit}
          disabled={rating === 0 || !comment.trim() || submitting}
          className="w-full bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
            </>
          ) : (
            'Submit Review'
          )}
        </button>
      </DialogContent>
    </Dialog>
  )
}
