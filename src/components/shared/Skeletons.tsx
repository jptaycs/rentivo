import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared loading skeletons.
 *
 * These mirror the real components' shapes closely enough that the page does
 * not jump when content replaces them — a skeleton whose size is wrong is
 * worse than a spinner, because it promises a layout it then breaks. Used by
 * route-level loading.tsx files (home, search, listing detail, host profile)
 * and by dashboard pages' own `loading` flags (client components that read a
 * hook's `loading` boolean). This file is the single home for all of them —
 * add new shapes here rather than hand-rolling another skeleton block inline.
 *
 * `Skeleton` itself (src/components/ui/skeleton.tsx) disables its pulse
 * animation under prefers-reduced-motion — see globals.css.
 */

/** One listing card, matching ListingCard's image + body proportions. */
export function ListingCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden bg-white shadow-sm border border-gray-100">
      <Skeleton className="h-48 w-full rounded-none" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
    </div>
  )
}

/** A responsive grid of listing cards. `count` should match the real page. */
export function ListingGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * The search page's filter sidebar — a heading plus several checkbox-row
 * groups. Only rendered md and up, matching FilterSidebar's own breakpoint.
 */
export function SearchFiltersSkeleton() {
  return (
    <div className="hidden md:block w-64 shrink-0 space-y-5">
      <Skeleton className="h-4 w-20" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

/** The full /search results area — sidebar + listing grid, same layout as SearchResults. */
export function SearchPageSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-6">
      <SearchFiltersSkeleton />
      <div className="flex-1">
        <ListingGridSkeleton count={count} />
      </div>
    </div>
  )
}

/**
 * Listing detail: gallery, specs column and the sticky booking panel. Real
 * page is long and variable-height (accessories/reviews/host card all vary
 * per listing), so this covers every fixed-shape section it always renders
 * rather than chasing exact pixels — narrows the jump without pretending to
 * eliminate it.
 */
export function ListingDetailSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Skeleton className="h-4 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-[420px] w-full rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Description */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          {/* Specs grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
          {/* Pricing tiers */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          {/* Pickup map */}
          <Skeleton className="h-64 w-full rounded-2xl" />
          {/* Reviews */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
          {/* Host card */}
          <div className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 p-5">
            <Skeleton className="w-14 h-14 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 sticky top-24">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Host profile: avatar block, stat row, plus a grid of that host's listings. */
export function HostProfileSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <Skeleton className="h-3 w-40" />
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <Skeleton className="w-24 h-24 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-5 w-40" />
        <ListingGridSkeleton count={4} />
      </div>
    </div>
  )
}

/**
 * Dashboard list rows — bookings, rentals, receipts, payouts, notifications.
 * `avatar` swaps the leading block between a square thumbnail and a circle.
 * `bare` drops the wrapping card (rows only) for use inside a page that
 * already renders its own surrounding white/border card around the loading
 * slot — double-wrapping would nest a border box inside a border box.
 */
export function DashboardRowsSkeleton({
  rows = 4,
  avatar = false,
  bare = false,
}: {
  rows?: number
  avatar?: boolean
  bare?: boolean
}) {
  const items = (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className={avatar ? 'w-10 h-10 rounded-full shrink-0' : 'w-14 h-14 rounded-xl shrink-0'} />
          <div className="flex-1 space-y-2 min-w-0">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <div className="space-y-2 shrink-0 hidden sm:block">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14 ml-auto" />
          </div>
        </div>
      ))}
    </>
  )
  if (bare) return <div className="divide-y divide-gray-100">{items}</div>
  return <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">{items}</div>
}

/** The stat tiles at the top of Overview, Earnings and Analytics. */
export function StatCardsSkeleton({
  count = 4,
  cols = 'grid-cols-2 lg:grid-cols-4',
}: {
  count?: number
  cols?: string
}) {
  return (
    <div className={`grid ${cols} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          <Skeleton className="h-8 w-8 rounded-xl" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/** A titled card with a bar chart — Overview/Earnings/Analytics' chart sections. */
export function ChartCardSkeleton({ bars = 7 }: { bars?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="flex items-end gap-2 h-32">
        {Array.from({ length: bars }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-t-lg rounded-b-none"
            style={{ height: `${30 + ((i * 37) % 70)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** A generic wide summary/balance card — payouts balance, reviews summary. */
export function SummaryCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-9 w-32 rounded-xl" />
    </div>
  )
}

/** Labeled form fields — Settings, Edit Listing. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ))}
    </div>
  )
}

/** The full Settings page — several stacked FormSkeleton-shaped sections. */
export function SettingsSkeleton() {
  return (
    <div className="p-6 space-y-8 max-w-2xl">
      <Skeleton className="h-7 w-48" />
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <Skeleton className="h-5 w-20" />
        <div className="flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-full shrink-0" />
          <Skeleton className="h-9 w-32 rounded-xl" />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <FormSkeleton fields={3} />
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Message thread list. */
export function ThreadListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="w-11 h-11 rounded-full shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A conversation panel while messages are loading — alternating bubble shapes. */
export function ConversationSkeleton() {
  const widths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-28']
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <Skeleton className="w-9 h-9 rounded-full shrink-0" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex-1 p-5 space-y-3">
        {widths.map((w, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
            <Skeleton className={`h-9 ${w} rounded-2xl`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Both messages panes together — thread list + conversation, initial page
 * load. Matches the real page's default `mobileView === 'list'` state: the
 * thread list is full-width below md (where the conversation pane is
 * genuinely hidden until a thread is picked), sidebar-width at md and up
 * alongside the conversation pane.
 */
export function MessagesPageSkeleton() {
  return (
    <div className="h-full flex">
      <div className="w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white shrink-0 flex flex-col">
        <ThreadListSkeleton />
      </div>
      <div className="flex-1 bg-[#F8FAFC] hidden md:flex">
        <ConversationSkeleton />
      </div>
    </div>
  )
}

/** The Availability Calendar page — listing-pill selector + month grid. */
export function CalendarSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <Skeleton className="h-3 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-xl" />
          <Skeleton className="h-8 w-28 rounded-xl" />
          <Skeleton className="h-8 w-24 rounded-xl" />
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="p-4 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
