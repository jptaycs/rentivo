'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Listing } from '@/types'

const KEY = 'rentivo_recently_viewed'
const MAX = 8

export function useRecentlyViewed() {
  const [items, setItems] = useState<Listing[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY)
      if (stored) setItems(JSON.parse(stored))
    } catch {}
  }, [])

  const addItem = useCallback((listing: Listing) => {
    setItems(prev => {
      const updated = [listing, ...prev.filter(i => i.id !== listing.id)].slice(0, MAX)
      try { localStorage.setItem(KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [])

  const clearItems = useCallback(() => {
    setItems([])
    try { localStorage.removeItem(KEY) } catch {}
  }, [])

  return { items, addItem, clearItems }
}
