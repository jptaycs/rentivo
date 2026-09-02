import type { RefObject } from 'react'
import { Clock } from 'lucide-react'
import { RECENT_EQUIPMENT, SUGGESTED_CATEGORIES } from './searchBarData'

export function WhatPanel({
  query, panelRef, style, onSelectQuery, onNavigate,
}: {
  query: string
  panelRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  onSelectQuery: (value: string) => void
  onNavigate: (href: string) => void
}) {
  const filteredEquipment = RECENT_EQUIPMENT.filter(e =>
    !query || e.name.toLowerCase().includes(query.toLowerCase())
  )
  const filteredCategories = SUGGESTED_CATEGORIES.filter(c =>
    !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.detail.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div ref={panelRef} style={style} className="animate-dropdown bg-white rounded-2xl shadow-2xl py-4 overflow-hidden">
      {filteredEquipment.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">Recent searches</p>
          {filteredEquipment.map((e, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelectQuery(e.name)}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-gray-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{e.name}</p>
                <p className="text-xs text-gray-500">{e.detail}</p>
              </div>
            </button>
          ))}
          <div className="border-t border-gray-100 my-2" />
        </>
      )}
      {filteredCategories.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 px-5 py-2">Browse by category</p>
          {filteredCategories.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onSelectQuery(c.label); onNavigate(c.href) }}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 text-xl">
                {c.emoji}
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.label}</p>
                <p className="text-xs text-gray-500">{c.detail}</p>
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
