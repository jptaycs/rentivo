import { HostProfileSkeleton } from '@/components/shared/Skeletons'

export default function HostProfileLoading() {
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <HostProfileSkeleton />
    </div>
  )
}
