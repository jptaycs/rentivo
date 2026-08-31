// Explicit columns — never `street_address`. Hosts' exact pickup address is
// only revealed after a booking is confirmed (see AGENTS.md privacy model);
// selecting `*` here would leak it into every listing page's RSC payload.
// Split into its own client-safe module (no next/headers import chain) so
// client components/hooks can reuse the exact same column list.
export const LISTING_COLUMNS =
  'id, host_id, category, brand, model, title, description, condition, daily_price, weekly_price, monthly_price, security_deposit, city, province, is_instant_book, is_active, rating, review_count, view_count, images, accessories, created_at'
