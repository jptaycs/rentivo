import type { RefObject } from 'react'
import { MapPin, Navigation } from 'lucide-react'
import { RECENT_SEARCHES, SUGGESTED_DESTINATIONS } from './searchBarData'

export function WherePanel({
  location, panelRef, style, onSelectLocation,
}: {
  location: string
  panelRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  onSelectLocation: (value: string) => void
}) {
  const filteredSuggestions = SUGGESTED_DESTINATIONS.filter(s =>
    !location || s.city.toLowerCase().includes(location.toLowerCase())
  )

  return (
    <div ref={panelRef} style={style} className="animate-dropdown bg-white rounded-2xl shadow-2xl py-4 overflow-hidden">
      {RECENT_SEARCHES.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">Recent searches</p>
          {RECENT_SEARCHES.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelectLocation(s.city)}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-gray-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{s.city}</p>
                <p className="text-xs text-gray-500">{s.detail}</p>
              </div>
            </button>
          ))}
          <div className="border-t border-gray-100 my-2" />
        </>
      )}
      <p className="text-xs font-semibold text-gray-500 px-5 py-2">Suggested destinations</p>
      {filteredSuggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelectLocation(s.type === 'nearby' ? '' : s.city)}
          className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
        >
          <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            {s.type === 'nearby'
              ? <Navigation className="w-5 h-5 text-[#003049]" />
              : <MapPin className="w-5 h-5 text-[#003049]" />
            }
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{s.city}</p>
            <p className="text-xs text-gray-500">{s.detail}</p>
          </div>
        </button>
      ))}
    </div>
  )
}
