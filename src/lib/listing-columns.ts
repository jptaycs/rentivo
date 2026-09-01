// Explicit columns — never `street_address`. Hosts' exact pickup address is
// only revealed after a booking is confirmed (see AGENTS.md privacy model);
// selecting `*` here would leak it into every listing page's RSC payload.
// Split into its own client-safe module (no next/headers import chain) so
// client components/hooks can reuse the exact same column list.
export const LISTING_COLUMNS =
  'id, host_id, category, brand, model, title, description, condition, daily_price, weekly_price, monthly_price, security_deposit, city, province, is_instant_book, is_active, is_draft, rating, review_count, view_count, images, accessories, created_at'

// Explicit columns for any `profiles` row joined into a *publicly readable*
// payload (listing cards, listing detail, search, host profiles, review
// authors). `profiles` has a `using (true)` public-read RLS policy, so a bare
// `profiles(*)` here ships every column of every host to the whole internet —
// exactly the `street_address` mistake above, one table over.
// Deliberately EXCLUDES `qr_payment_label`: it's host-authored free text that
// in practice holds a real name + mobile number ("GCash — Juan Dela Cruz,
// 09XX XXX XXXX"). It is only ever served to the two parties on a booking,
// via GET /api/bookings/[id]/qr. `qr_payment_url` IS included: it's an opaque
// private-bucket storage path (useless without a signed URL) that the checkout
// tile needs to know whether the host accepts QR payment at all.
// Also excludes the `notify_*` preference columns — nobody but the owning user
// reads those, and useProfile() fetches the full row for that.
export const PROFILE_COLUMNS =
  'id, full_name, avatar_url, is_verified, is_host, host_rating, host_review_count, response_time_hours, bio, city, created_at, qr_payment_url'
