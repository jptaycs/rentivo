import { Skeleton } from '@/components/ui/skeleton'

/**
 * Not one of this task's named routes, but /book (like home) fetches data
 * directly in an async page.tsx with no internal Suspense boundary, and this
 * directory has no own loading.tsx to fall back on other than the (main)
 * root's home-shaped one — so without this file, navigating to /book while
 * data loads would show the home skeleton instead, a real layout-stability
 * regression introduced by adding (main)/loading.tsx. See that file's
 * comment.
 */
export default function BookLoading() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
        <div>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
