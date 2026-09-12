// Explicit columns — never `street_address`. Hosts' exact pickup address is
// only revealed after a booking is confirmed (see AGENTS.md privacy model);
// selecting `*` here would leak it into every listing page's RSC payload.
// Split into its own client-safe module (no next/headers import chain) so
// client components/hooks can reuse the exact same column list.
// approx_latitude/approx_longitude/location_is_exact (065) are the ONLY
// public coordinates — GENERATED columns rounded to 2dp so the true point
// can only be ~775m away. Exact `latitude`/`longitude` are revoked at the
// table level and reachable only via a confirmed-booking-gated RPC. Never
// add `latitude`/`longitude` here.
export const LISTING_COLUMNS =
  'id, host_id, category, brand, model, title, description, condition, daily_price, weekly_price, monthly_price, security_deposit, delivery_fee, city, province, is_instant_book, is_active, is_draft, rating, review_count, view_count, images, accessories, created_at, approx_latitude, approx_longitude, location_is_exact'

// Explicit columns for any `profiles` row joined into a *publicly readable*
// payload (listing cards, listing detail, search, host profiles, review
// authors). `profiles` has a `using (true)` public-read RLS policy, so a bare
// `profiles(*)` here ships every column of every host to the whole internet —
// exactly the `street_address` mistake above, one table over.
// Also excludes the `notify_*` preference columns — nobody but the owning user
// reads those, and useProfile() fetches the full row for that.
export const PROFILE_COLUMNS =
  'id, full_name, avatar_url, is_verified, is_host, host_rating, host_review_count, response_time_hours, bio, city, created_at'
