import type { RefObject } from 'react'
import { MapPin } from 'lucide-react'
import { searchPhLocations, type PhLocation } from '@/lib/ph-locations'

function LocationRow({
  loc, onSelect,
}: {
  loc: PhLocation
  onSelect: (value: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(loc.value)}
      className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
    >
      <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
        <MapPin className="w-5 h-5 text-[#003049]" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{loc.city}</p>
        <p className="text-xs text-gray-500 truncate">{loc.province}</p>
      </div>
    </button>
  )
}

export function WherePanel({
  location, panelRef, style, onSelectLocation,
}: {
  location: string
  panelRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  onSelectLocation: (value: string) => void
}) {
  // Suggestions come from src/lib/ph-locations.ts — the same table the pickup
  // and search maps pin against — so all 145 cities are offered, not the four
  // that used to be hardcoded here. Those four were also stored as
  // "Manila, Philippines" and fed straight into `?city=`, which searchListings()
  // turns into `ilike '%Manila, Philippines%'`; since the column only ever holds
  // "Manila", every one of them returned zero results when clicked.
  const { matches, related, relatedProvince } = searchPhLocations(location)
  const typed = location.trim().length > 0

  return (
    <div ref={panelRef} style={style} className="animate-dropdown bg-white rounded-2xl shadow-2xl py-4 overflow-hidden max-h-[22rem] overflow-y-auto">
      {matches.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm font-semibold text-gray-900">No matching location</p>
          <p className="text-xs text-gray-500 mt-1">
            Try a city or province name — or search without a location to see everything.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">
            {typed ? 'Locations' : 'Popular destinations'}
          </p>
          {matches.map((loc) => (
            <LocationRow key={`m:${loc.province}|${loc.city}`} loc={loc} onSelect={onSelectLocation} />
          ))}

          {relatedProvince && related.length > 0 && (
            <>
              <div className="border-t border-gray-100 my-2" />
              <p className="text-xs font-semibold text-gray-500 px-5 py-2">
                Elsewhere in {relatedProvince}
              </p>
              {related.map((loc) => (
                <LocationRow key={`r:${loc.province}|${loc.city}`} loc={loc} onSelect={onSelectLocation} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
