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

export const RECENT_SEARCHES = [
  { city: 'Manila', detail: 'Jun 30 – Jul 7' },
  { city: 'Cebu City', detail: 'Jul 1 – 5' },
  { city: 'Davao City', detail: 'Jul 15 – 20' },
]
export const SUGGESTED_DESTINATIONS = [
  { city: 'Nearby', detail: 'Find gear around you', type: 'nearby' as const },
  { city: 'Manila, Philippines', detail: 'Most listings available', type: 'city' as const },
  { city: 'Cebu City, Philippines', detail: 'Growing creator community', type: 'city' as const },
  { city: 'Davao City, Philippines', detail: 'Great for outdoor shoots', type: 'city' as const },
  { city: 'Quezon City, Philippines', detail: 'Film and studio hub', type: 'city' as const },
]
