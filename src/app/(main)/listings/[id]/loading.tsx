import { ListingDetailSkeleton } from '@/components/shared/Skeletons'

export default function ListingLoading() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <ListingDetailSkeleton />
    </div>
  )
}
