import Link from 'next/link'
import { BadgeCheck, Star, Clock, Calendar, ExternalLink } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { Profile } from '@/types'

interface HostCardProps {
  host: Profile
}

export function HostCard({ host }: HostCardProps) {
  const initials = host.full_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const joinYear = new Date(host.created_at).getFullYear()
  const yearsHosting = new Date().getFullYear() - joinYear || 1

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-start gap-4 mb-5">
        <Avatar className="w-16 h-16 ring-2 ring-[#2563EB]/20">
          <AvatarImage src={host.avatar_url ?? ''} />
          <AvatarFallback className="bg-[#2563EB] text-white font-bold text-lg">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-[#111827]">{host.full_name}</h3>
            {host.is_verified && (
              <BadgeCheck className="w-5 h-5 text-[#2563EB]" />
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Host since {joinYear}</p>
          {host.host_rating && (
            <div className="flex items-center gap-1 mt-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="text-sm font-semibold">{host.host_rating}</span>
              <span className="text-xs text-gray-400">({host.host_review_count} reviews)</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-[#F8FAFC] rounded-xl p-3 text-center">
          <Clock className="w-4 h-4 text-[#2563EB] mx-auto mb-1" />
          <p className="text-xs text-gray-500">Response time</p>
          <p className="text-sm font-semibold text-[#111827]">
            {host.response_time_hours
              ? host.response_time_hours < 2
                ? 'Within 1 hr'
                : `~${host.response_time_hours} hrs`
              : 'Fast'}
          </p>
        </div>
        <div className="bg-[#F8FAFC] rounded-xl p-3 text-center">
          <Calendar className="w-4 h-4 text-[#2563EB] mx-auto mb-1" />
          <p className="text-xs text-gray-500">Years hosting</p>
          <p className="text-sm font-semibold text-[#111827]">{yearsHosting} yr{yearsHosting > 1 ? 's' : ''}</p>
        </div>
      </div>

      <Link
        href="/dashboard/messages"
        className="w-full border border-[#2563EB] text-[#2563EB] font-semibold py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
      >
        Message Host
      </Link>
      <Link
        href={`/hosts/${host.id}`}
        className="w-full mt-2 text-center text-xs font-semibold text-gray-400 hover:text-[#2563EB] transition-colors flex items-center justify-center gap-1 py-1"
      >
        <ExternalLink className="w-3 h-3" /> View full profile
      </Link>
    </div>
  )
}
