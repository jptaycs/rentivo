// Static copy/data for the search bar's popovers. Extracted from the original HeroSearch
// monolith unchanged.

export const SUGGESTIONS = ['Sony A7 IV', 'Canon EOS R6', 'Nikon Z8', 'Fujifilm X100VI', 'iPhone 16 Pro Max', 'Samsung Galaxy S25 Ultra', 'Sony 24-70mm GM II']
export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
export const DAY_LABELS = ['S','M','T','W','T','F','S']
export const FLEX_OPTIONS = ['Exact dates','± 1 day','± 2 days','± 3 days','± 7 days','± 14 days']

export const RECENT_EQUIPMENT = [
  { name: 'Sony A7 IV', detail: 'Full-frame mirrorless' },
  { name: 'iPhone 16 Pro Max', detail: 'Smartphone' },
  { name: 'Canon RF 24-70mm f/2.8', detail: 'Lens' },
]
export const SUGGESTED_CATEGORIES = [
  { label: 'Cameras', detail: 'Mirrorless, DSLR & Cinema', emoji: '📷', href: '/search?category=mirrorless' },
  { label: 'Phones', detail: 'iOS & Android', emoji: '📱', href: '/search?category=smartphone' },
  { label: 'Lenses', detail: 'Prime & Zoom', emoji: '🎯', href: '/search?category=lens' },
  { label: 'Creator Kits', detail: 'Complete bundles', emoji: '🎥', href: '/search?category=bundle' },
]

// RECENT_SEARCHES and SUGGESTED_DESTINATIONS were removed on 2026-09-03.
// RECENT_SEARCHES was invented history — the same three cities with made-up
// date ranges shown identically to every visitor, including brand-new ones,
// under a heading claiming they were the user's own searches. Nothing records
// per-user search history, so there was nothing real to show.
// SUGGESTED_DESTINATIONS was four hardcoded cities whose values ("Manila,
// Philippines") were fed straight into `?city=` and matched with
// `ilike '%…%'` against a column holding "Manila" — so every suggestion
// returned zero results. WherePanel now derives every location from
// src/lib/ph-locations.ts, the table the maps already pin against.
