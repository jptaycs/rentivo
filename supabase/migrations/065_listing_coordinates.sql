-- 065: coordinate columns for the exact-pickup-point feature.
--
-- approx_* are GENERATED, not written by anything: the public value cannot
-- drift from the private one, and there is no code path that could publish an
-- exact coordinate by mistake.
--
-- 2 decimal places is deliberate and is the whole privacy mechanism. It shifts
-- a point by at most ~775m. 3dp shifts by ~77m, which would disclose the host's
-- house while calling itself "approximate" -- see the spec, which records that
-- as the design's own first mistake.
alter table public.listings
  add column location_is_exact boolean not null default false,
  add column approx_latitude  numeric(10,7) generated always as (round(latitude, 2)) stored,
  add column approx_longitude numeric(10,7) generated always as (round(longitude, 2)) stored;

comment on column public.listings.location_is_exact is
  'True only when a host placed the pin. False for rows backfilled from the city centre (066) -- no UI may claim precision for these.';

-- 064 revoked table-level SELECT, so new columns are invisible until granted.
grant select (approx_latitude, approx_longitude, location_is_exact)
  on public.listings to anon, authenticated;
