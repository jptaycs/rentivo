import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { MessageThread } from '@/hooks/useThreads'

interface ThreadListProps {
  threads: MessageThread[]
  activeId: string | null
  onSelect: (id: string) => void
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function ThreadList({ threads, activeId, onSelect }: ThreadListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-100">
        <h2 className="font-bold text-[#111827]">Messages</h2>
        <p className="text-xs text-gray-400 mt-0.5">{threads.filter(t => t.unreadCount > 0).length} unread</p>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {threads.map(t => (
          <button
            key={t.conversationId}
            onClick={() => onSelect(t.conversationId)}
            className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-gray-50 transition-colors ${
              activeId === t.conversationId ? 'bg-blue-50/60' : ''
            }`}
          >
            {/* Avatar — the profile photo when there is one, initials otherwise.
                This page rendered initials unconditionally for its whole history
                even though avatar_url has always been available on otherUser, so
                a host with a photo showed a blank-looking letter here while the
                navbar and sidebar showed their real picture. */}
            <Avatar className="w-10 h-10 shrink-0">
              <AvatarImage src={t.otherUser.avatar_url ?? ''} alt={t.otherUser.full_name} />
              <AvatarFallback className={`font-bold text-sm ${
                activeId === t.conversationId ? 'bg-[#003049] text-white' : 'bg-gray-100 text-gray-600'
              }`}>
                {t.otherUser.full_name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm truncate ${t.unreadCount > 0 ? 'font-bold text-[#111827]' : 'font-medium text-gray-700'}`}>
                  {t.otherUser.full_name}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(t.lastAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className="text-xs text-gray-400 truncate">{t.listingTitle}</p>
                {t.isInquiry
                  ? <span className="text-[10px] font-semibold text-[#003049] bg-blue-50 px-1.5 py-0.5 rounded shrink-0">Inquiry</span>
                  : <span className="text-[10px] text-gray-400 shrink-0">{t.bookingRef}</span>}
              </div>
              <p className={`text-xs truncate mt-0.5 ${t.unreadCount > 0 ? 'text-[#111827] font-medium' : 'text-gray-400'}`}>
                {t.lastMessage}
              </p>
            </div>

            {/* Unread badge */}
            {t.unreadCount > 0 && (
              <span className="w-5 h-5 bg-[#003049] text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0 mt-0.5">
                {t.unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
