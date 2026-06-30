'use client'

import { useEffect } from 'react'
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed'
import type { Listing } from '@/types'

export function ViewTracker({ listing }: { listing: Listing }) {
  const { addItem } = useRecentlyViewed()
  useEffect(() => { addItem(listing) }, [listing.id])
  return null
}
