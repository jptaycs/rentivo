-- 064: close the raw-PostgREST exposure of listings' private columns.
--
-- LISTING_COLUMNS (src/lib/listing-columns.ts) has excluded street_address
-- since the leak found while building the pickup map, and AGENTS.md records
-- that as fixed. It was only ever fixed for the app's OWN queries. `listings`
-- still carried a table-level SELECT grant to anon/authenticated, so a direct
-- call with nothing but the public anon key read the private columns anyway:
--
--   GET /rest/v1/listings?select=street_address,serial_number
--
-- Verified before writing this migration: that call returned 200 with a real
-- host's home address ("Zone 5 Tanlad Street Calauag") and an equipment serial
-- number. This is the identical situation `profiles` was in until migration
-- 059 closed qr_payment_label — app paths clean, raw path open — and nobody
-- re-checked `listings` when 059 was written.
--
-- Same shape as 059, and the order is load-bearing: in Postgres a table-level
-- privilege satisfies access to ANY column, so a column grant list only means
-- something once the table-level grant is gone (see the 040 write-up).
--
-- Private after this: street_address, serial_number, latitude, longitude,
-- search_vector. Nothing in the app reads any of them under a user session —
-- the only bare `select('*')` was the listing edit page, changed in the same
-- commit to use LISTING_COLUMNS. `search_vector` is safe to withhold because
-- searchListings() matches with ilike on title/brand/model, never on it.
--
-- latitude/longitude are included in the revoke deliberately: they are null
-- everywhere today, and the exact-pickup-coordinates work (spec
-- 2026-09-05-exact-pickup-coordinates-design.md) is about to populate them.
-- Closing them now means that feature starts from a private default rather
-- than having to remember to close them later.

revoke select on public.listings from anon, authenticated;

grant select (
  id,
  host_id,
  category,
  brand,
  model,
  title,
  description,
  condition,
  daily_price,
  weekly_price,
  monthly_price,
  security_deposit,
  delivery_fee,
  city,
  province,
  is_instant_book,
  is_active,
  is_draft,
  rating,
  review_count,
  view_count,
  images,
  accessories,
  created_at,
  updated_at
) on public.listings to anon, authenticated;

-- Writes are unaffected: this touches SELECT only. The host wizard's insert
-- returns `.select('id')` and its retry-update returns nothing, so neither
-- needs a column that is now private.
