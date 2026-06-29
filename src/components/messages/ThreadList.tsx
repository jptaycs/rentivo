import type { Thread } from '@/lib/mock-messages'

interface ThreadListProps {
  threads: Thread[]
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
        <p className="text-xs text-gray-400 mt-0.5">{threads.filter(t => t.unread > 0).length} unread</p>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {threads.map(t => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-gray-50 transition-colors ${
              activeId === t.id ? 'bg-blue-50/60' : ''
            }`}
          >
            {/* Avatar */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
              activeId === t.id ? 'bg-[#003049] text-white' : 'bg-gray-100 text-gray-600'
            }`}>
              {t.otherUser.initial}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm truncate ${t.unread > 0 ? 'font-bold text-[#111827]' : 'font-medium text-gray-700'}`}>
                  {t.otherUser.name}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(t.lastAt)}</span>
              </div>
              <p className="text-xs text-gray-400 truncate mt-0.5">{t.equipment}</p>
              <p className={`text-xs truncate mt-0.5 ${t.unread > 0 ? 'text-[#111827] font-medium' : 'text-gray-400'}`}>
                {t.lastMessage}
              </p>
            </div>

            {/* Unread badge */}
            {t.unread > 0 && (
              <span className="w-5 h-5 bg-[#003049] text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0 mt-0.5">
                {t.unread}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
