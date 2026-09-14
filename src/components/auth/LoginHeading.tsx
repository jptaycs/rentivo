'use client'

import { useEffect, useState } from 'react'

// Signed-out taps on the mobile bottom nav's Bookings/Wishlist tabs land
// here via the /dashboard middleware redirect with no explanation — the
// owner's "Bookings/Wishlist show nothing when signed out" complaint. This
// swaps the heading to say why, for exactly those two destinations; every
// other `?next=` (or none) keeps the original copy.
const COPY: Record<string, { heading: string; subheading: string }> = {
  '/dashboard/rentals': {
    heading: 'Sign in to see your bookings',
    subheading: 'Your upcoming and past rentals are waiting for you.',
  },
  '/dashboard/wishlist': {
    heading: 'Sign in to see your wishlist',
    subheading: 'The gear you saved is waiting for you.',
  },
}

const DEFAULT = {
  heading: 'Welcome back',
  subheading: 'Sign in to your Rentivo account to continue.',
}

function resolveCopy() {
  const next = new URLSearchParams(window.location.search).get('next') || ''
  const path = next.split('?')[0]
  const entry = Object.entries(COPY).find(([p]) => path === p || path.startsWith(`${p}/`))
  return entry ? entry[1] : DEFAULT
}

// Read client-side (not useSearchParams()) so /login can stay statically
// prerendered — same reasoning as LoginForm's existing `next`/`suspended`
// reads. The server-rendered fallback is the default copy, so there's no
// layout shift for the common case of arriving at /login directly.
export function LoginHeading() {
  const [text, setText] = useState(DEFAULT.heading)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(resolveCopy().heading)
  }, [])
  return text
}

export function LoginSubheading() {
  const [text, setText] = useState(DEFAULT.subheading)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(resolveCopy().subheading)
  }, [])
  return text
}
