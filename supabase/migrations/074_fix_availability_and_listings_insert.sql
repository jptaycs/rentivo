-- 074: fixes two gaps left by migration 073 (see
-- .superpowers/sdd/2026-09-13-retire-host-qr-and-billing/security-fix-review.md
-- for the review that found both). 073 is already applied to production and
-- is NOT edited here. Never edit create_booking; none of this touches it.

-- ────────────────────────────────────────────────────────────────
-- CRITICAL — 073's "availability: host manage manual" policy required
-- reason = 'manual' in both USING and WITH CHECK, but
-- src/components/host/ListingWizard.tsx:170 inserts blocked dates with
-- reason: 'personal' — the literal 001_initial_schema.sql:114 documents
-- ('booked' | 'personal' | null) and one 4 live rows already carry. Result:
-- every host's wizard-step blocked-date insert now fails (silently, in the
-- wizard's non-fatal warning path), and those 4 existing rows became
-- undeletable by their own host via src/hooks/useAvailabilityBlocks.ts:47-63
-- (its DELETE now matches 0 rows, returns no error, and the calendar just
-- redraws with the block still there).
--
-- Fix: widen the predicate to every reason a client legitimately writes —
-- i.e. anything that is not 'booked' — rather than enumerating literals.
-- 'booked' rows are written only by block_availability_on_confirm (SECURITY
-- DEFINER, executes as the function owner regardless of this policy) and
-- must stay untouchable by a host; 'manual' and 'personal' (and NULL, for
-- any pre-existing row that predates both labels) must stay host-writable.
--
-- Using "is distinct from", not "<>": reason is nullable, and
-- NULL <> 'booked' evaluates to NULL (neither true nor false), which
-- Postgres treats as "do not allow" for USING/WITH CHECK — silently
-- refusing every NULL-reason row rather than the intended "any non-booked
-- reason including NULL is fine". Same NULL-safety class AGENTS.md already
-- documents for migration 030. "is distinct from" is NULL-safe: it reads as
-- true whenever the value genuinely isn't 'booked', NULL included.
--
-- This also closes the relabel-then-delete sidestep MEDIUM-2 in 073 was
-- written to prevent: a 'booked' row's CURRENT reason is 'booked', so
-- `reason is distinct from 'booked'` evaluates to false against it and
-- USING excludes the row from UPDATE entirely — a host can never even
-- begin an UPDATE that would relabel it to 'manual', let alone then delete
-- it. WITH CHECK repeats the same predicate so a host also can't INSERT a
-- fresh row already labelled to dodge this later (matching 073's own
-- reasoning for requiring both clauses).
drop policy "availability: host manage manual" on public.availability_blocks;

create policy "availability: host manage non-booked"
  on public.availability_blocks for all
  to authenticated
  using (
    reason is distinct from 'booked'
    and exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  )
  with check (
    reason is distinct from 'booked'
    and exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  );

-- "availability: public read" is untouched — reading blocked dates
-- (including 'booked' ones) stays public.

-- ────────────────────────────────────────────────────────────────
-- IMPORTANT — 073 revoked table-level UPDATE on listings but left
-- table-level INSERT wide open (33 columns, to both anon and authenticated),
-- and "listings: authenticated insert"'s WITH CHECK is only
-- auth.uid() = host_id. A host can therefore still forge rating /
-- review_count / view_count at INSERT time — same reputation forgery
-- 073 exists to stop, reached with a different verb, and nothing ever
-- overwrites those values until a real review or view actually happens.
--
-- Column list is deliberately NOT copied from 073's UPDATE grant — it is
-- read straight from the one real insert call site,
-- src/components/host/ListingWizard.tsx:120-142's `fields` object, which is
-- reused unmodified as the INSERT payload at :154-155. That object omits
-- is_active (never set on create — the column's own default of true
-- applies), so the INSERT list below is the UPDATE list minus is_active,
-- not the same 22 columns:
--   host_id, category, brand, model, title, description, condition,
--   daily_price, weekly_price, monthly_price, security_deposit,
--   delivery_fee, city, province, street_address, is_instant_book,
--   latitude, longitude, location_is_exact, images, accessories
--
-- host_id is included for the same reason 073 included it on UPDATE: the
-- shared `fields` object always names it (as the caller's own auth.uid()),
-- and "listings: authenticated insert"'s WITH CHECK (auth.uid() = host_id)
-- refuses any other value regardless of the column grant — a column
-- privilege lets a value be written, RLS still decides whether that value
-- is allowed.
--
-- Deliberately excluded, none written by the app's one insert call site:
-- rating, review_count, view_count (trigger/RPC-derived — the whole point
-- of this fix), is_active, is_draft (037's force_draft_when_unverified /
-- block_self_publish decide this, not the client), serial_number (no UI
-- field writes it — see 073's own caveat that /privacy's mention of serial
-- numbers means a future UI field must extend this grant when it lands),
-- search_vector (trigger-derived), approx_latitude / approx_longitude
-- (GENERATED ALWAYS, not directly settable), id, created_at, updated_at.
revoke insert on public.listings from anon, authenticated;

grant insert (
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
  accessories
) on public.listings to authenticated;
