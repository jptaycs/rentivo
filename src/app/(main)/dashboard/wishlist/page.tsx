import { redirect } from 'next/navigation'

// Wishlist moved out from behind the /dashboard auth gate to a public
// /wishlist page (2026-09-14) — a guest's hearts are real (localStorage)
// but were unreachable, since this was the only page that rendered them.
// Kept as a redirect rather than deleted so old links / browser history
// still land somewhere. Do not rebuild the grid here — see /wishlist.
export default function DashboardWishlistRedirect() {
  redirect('/wishlist')
}
