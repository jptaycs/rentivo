-- 073: close three table-level write holes proven live by the 2026-09-13
-- security audit (.superpowers/sdd/2026-09-13-retire-host-qr-and-billing/
-- security-audit.md). All three are the identical mechanism 040 already
-- documents: a TABLE-level grant satisfies a write to ANY column, so a
-- column-level grant list is decorative until the table-level grant is
-- revoked first. Never edit create_booking; none of this touches it.

-- ────────────────────────────────────────────────────────────────
-- HIGH-1 — listings: a host could forge their own listing's rating,
-- review_count and view_count (all three are trigger/RPC-derived, never
-- host input). Proven live: PATCH {"rating":5,"review_count":999,
-- "view_count":12345} on a real listing returned 204 and stuck.
--
-- Column list below is exactly what the app's three user-session write
-- sites use today — read from source, not guessed:
--   src/components/host/ListingWizard.tsx:120-142  (insert AND retry-update
--     share one `fields` object: host_id, category, brand, model, title,
--     description, condition, daily_price, weekly_price, monthly_price,
--     security_deposit, delivery_fee, city, province, street_address,
--     is_instant_book, latitude, longitude, location_is_exact, images,
--     accessories)
--   src/app/(main)/dashboard/listings/[id]/edit/page.tsx:145-162 (title,
--     description, category, condition, daily_price, weekly_price,
--     monthly_price, security_deposit, delivery_fee, is_instant_book,
--     latitude, longitude, location_is_exact) and :179-181 (is_active)
--   src/hooks/useMyListings.ts:51-53 (is_active)
--
-- host_id IS included, deliberately: ListingWizard's shared `fields` object
-- names it on every update (not just insert), always as the caller's own
-- auth.uid() — a column named in an UPDATE's SET list needs the column
-- privilege even when the value doesn't change. This is safe to grant
-- because "listings: host update"'s USING clause (auth.uid() = host_id) is
-- reused as WITH CHECK when no separate WITH CHECK is given (as here), so
-- Postgres itself re-checks auth.uid() = host_id against the NEW row —
-- laundering a listing to another host_id is refused by RLS regardless of
-- the column grant. Already proven live per the audit ("host_id laundering
-- attempt was refused with new row violates row-level security policy").
--
-- Deliberately excluded, none of them written by any user-session call
-- site today: rating, review_count, view_count (trigger/RPC-derived — the
-- whole point of this fix), serial_number (no UI field writes it),
-- is_draft (publication state is trigger-controlled only — 037's
-- force_draft_when_unverified / block_self_publish — and no call site
-- ever sets it), search_vector (trigger-derived), approx_latitude /
-- approx_longitude (GENERATED ALWAYS, not directly settable), id,
-- created_at, updated_at.
revoke update on public.listings from anon, authenticated;

grant update (
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
  street_address,
  is_instant_book,
  latitude,
  longitude,
  location_is_exact,
  images,
  accessories,
  is_active
) on public.listings to authenticated;

-- ────────────────────────────────────────────────────────────────
-- MEDIUM-2 — availability_blocks: "availability: host manage" let a host
-- delete a `reason = 'booked'` row (written only by the
-- block_availability_on_confirm trigger, security definer, when a booking
-- is confirmed) as freely as their own manual blocks, re-opening dates a
-- renter already paid for so the same camera could be double-booked.
-- Proven live: a probe 'booked' row was inserted and then deleted via the
-- same policy that scopes a host to their own listings.
--
-- Fix scopes the host-managed policy to reason = 'manual' only — the exact
-- literal src/hooks/useAvailabilityBlocks.ts:68 inserts for a manual block,
-- and the only reason value any client ever writes. The trigger that writes
-- 'booked' rows is security definer, so it is entirely unaffected by this
-- policy change (security definer functions execute with the function
-- owner's privileges, not the RLS-restricted caller's). WITH CHECK is
-- required in addition to USING: without it a host could insert a row
-- pre-labelled 'booked' (satisfying USING's absence at insert time is not
-- the risk — the risk is a row that, once inserted, could never be
-- deleted under this same policy) or relabel a manual row to 'booked' to
-- dodge this restriction later.
drop policy "availability: host manage" on public.availability_blocks;

create policy "availability: host manage manual"
  on public.availability_blocks for all
  to authenticated
  using (
    reason = 'manual'
    and exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  )
  with check (
    reason = 'manual'
    and exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  );

-- "availability: public read" (using (true), select-only) is untouched —
-- reading blocked dates, including 'booked' ones, stays public; this only
-- narrows who may INSERT/UPDATE/DELETE and which rows.

-- ────────────────────────────────────────────────────────────────
-- LOW-5 — notifications: migration 012's `grant update (is_read)` was
-- decorative for the same table-level reason — a user could rewrite their
-- own notification's title/body/type/link. Proven live (inadvertently,
-- during the audit itself — 19 rows were rewritten and restored). The
-- policy's USING doubles as WITH CHECK and already scopes to
-- auth.uid() = user_id, so this was never cross-user; it only let a user
-- mislead themselves. Revoke-then-grant, same pattern as 040/059/064.
revoke update on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;

-- ────────────────────────────────────────────────────────────────
-- LOW-7 — search_listings(...) is SECURITY INVOKER, EXECUTE granted to
-- PUBLIC by default (never explicitly revoked), and has 401'd since
-- migration 064's listings column-select revoke (it selects
-- search_vector and other now-private columns; Postgres checks column
-- privileges at plan time regardless of which branch runs). A grep of
-- src/ confirms nothing calls it — searchListings() in src/lib/listings.ts
-- is the real, column-allowlisted search path and always has been. Dropped
-- outright rather than merely re-granted-and-fixed: a publicly-granted,
-- permanently-broken function is exactly the kind of dead surface someone
-- later "fixes" by widening a grant on listings, which would undo 064. If
-- full-text search via RPC is ever wanted again, it should be written
-- security definer with an explicit column list, not a widened grant.
drop function if exists public.search_listings(
  text, equipment_category, text, text, integer, integer, boolean, boolean,
  numeric, date, date, integer, integer
);
