-- 068: tighten the public coordinate rounding from 2 decimals to 3.
--
-- OWNER DECISION (2026-09-06), taken with the trade-off stated twice: nearby
-- listings were merging to a single published point, so the published grid goes
-- from ~1.1km to ~108m.
--
-- What this costs, recorded plainly because 065 argued the other way: rounding
-- to 3 decimals displaces a point by at most ~77m, so the published location is
-- within a building or two of the host's actual pin in a dense city. 065 chose
-- 2dp precisely to avoid that. This migration reverses that choice at the
-- owner's request.
--
-- What it does NOT do: fix the merging visible today. The 23 active listings
-- share only 9 distinct STORED coordinates (all city-centre backfills from
-- 066), so they collapse to 9 points at 2dp, at 3dp, and at full precision
-- alike. This only separates pins that hosts genuinely place within ~1.1km of
-- each other from here on.
--
-- A generated column's expression cannot be altered in place, so each column is
-- dropped and re-added. Dropping a column also drops its column-level GRANT --
-- and 064 revoked table-level SELECT on listings -- so the grant MUST be
-- re-issued below or every public map silently loses its coordinates.
--
-- The 1km circle drawn on the listing page is coupled to this value and shrinks
-- to 150m in the same commit. A circle wider than the rounding error is merely
-- generous; one narrower than it is a false claim, because the true point could
-- fall outside it.

alter table public.listings
  drop column approx_latitude,
  drop column approx_longitude;

alter table public.listings
  add column approx_latitude  numeric(10,7) generated always as (round(latitude, 3)) stored,
  add column approx_longitude numeric(10,7) generated always as (round(longitude, 3)) stored;

-- Re-grant: the drop above took the old column-level grants with it.
grant select (approx_latitude, approx_longitude)
  on public.listings to anon, authenticated;
