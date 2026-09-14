import { Skeleton } from '@/components/ui/skeleton'
import { DashboardRowsSkeleton, StatCardsSkeleton } from '@/components/shared/Skeletons'

/**
 * Route-level loading UI for every /dashboard/* segment.
 *
 * This exists because the nearest ancestor loading.tsx is (main)/loading.tsx,
 * the HOME page skeleton — without this file, navigating to a dashboard route
 * flashed a dark hero band and listing-card grid before the dashboard page
 * rendered (measured: 6219px of home-shaped skeleton against a 1599px
 * dashboard page). It sits inside dashboard/layout.tsx, so the sidebar and
 * mobile top bar stay put and only the content column is replaced.
 *
 * Deliberately generic — the pages under here are three shapes (stat cards,
 * rows, forms) and this boundary only covers the brief window before a client
 * page mounts; each page then renders its own shape-accurate skeleton while
 * its data loads.
 */
export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <StatCardsSkeleton />
      <DashboardRowsSkeleton rows={3} />
    </div>
  )
}
