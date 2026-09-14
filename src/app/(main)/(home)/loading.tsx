import { Skeleton } from '@/components/ui/skeleton'
import { ListingGridSkeleton } from '@/components/shared/Skeletons'

/**
 * Route-level loading UI for the home page only.
 *
 * It lives in the (home) route group — a group changes nothing about the URL,
 * but it scopes this boundary to the home page alone. It used to sit directly
 * in (main)/, where it was also the fallback for every other route in the
 * group that had none of its own, so a dashboard route briefly rendered a
 * home hero band and listing grid before its own skeleton appeared (measured:
 * 6219px of home-shaped skeleton against a 1599px dashboard page). Don't move
 * it back up a level.
 */
export default function HomeLoading() {
  return (
    <>
      {/* Hero search — fixed-height dark band, no data dependency */}
      <div className="bg-[#003049] px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-10 w-3/4 mx-auto bg-white/10" />
          <Skeleton className="h-10 w-1/2 mx-auto bg-white/10" />
          <Skeleton className="h-16 w-full max-w-2xl mx-auto rounded-full bg-white/10" />
        </div>
      </div>

      {/* Category cards */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Featured listings grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-7 w-56" />
        <ListingGridSkeleton count={8} />
      </div>

      {/* Popular Near You — horizontal-scroll row, one card's height regardless of count */}
      <div className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="w-56 h-52 rounded-xl shrink-0" />
            ))}
          </div>
        </div>
      </div>

      {/* Creator Bundles */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-7 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Why Rentivo */}
      <div className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <Skeleton className="h-8 w-48 mx-auto" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-12 w-12 rounded-full mx-auto" />
                <Skeleton className="h-4 w-32 mx-auto" />
                <Skeleton className="h-3 w-40 mx-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
