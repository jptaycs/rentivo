-- 069: return the host's street address alongside the exact coordinates.
--
-- Why: five screens promised renters the exact pickup address once a booking is
-- confirmed, and `street_address` was surfaced to nobody, anywhere — the copy
-- was corrected on 2026-09-06 to stop claiming it. The owner then chose to make
-- the original promise true rather than drop it: a map pin finds a house but not
-- a unit on the 14th floor.
--
-- This is a real disclosure, not a copy change: a host's full street address now
-- reaches a renter the moment their booking is confirmed. The gate below is the
-- only thing standing between that address and everyone else, so it is
-- deliberately left BYTE-IDENTICAL to 067's — same entitled callers, same
-- excluded `pending`. Only the select list widens.
--
-- Extending 067 rather than adding a second gated function is deliberate: two
-- functions guarding the same data are two things to keep in sync, and this repo
-- has been bitten by exactly that (create_booking's body copied across
-- migrations, twice causing security incidents).
--
-- Postgres will not let `create or replace` change a function's return type, so
-- this drops and recreates. **Dropping a function drops its GRANTs** — the same
-- trap as the column grants in 068 — so the grant/revoke pair is re-issued
-- below. Without it every caller gets "permission denied for function".

drop function if exists public.get_listing_coordinates(uuid);

create function public.get_listing_coordinates(p_listing_id uuid)
returns table (latitude numeric, longitude numeric, street_address text)
language sql
security definer
stable
set search_path = public
as $$
  select l.latitude, l.longitude, l.street_address
  from public.listings l
  where l.id = p_listing_id
    and (
      l.host_id = auth.uid()
      or exists (
        select 1
        from public.bookings b
        where b.listing_id = l.id
          and b.renter_id  = auth.uid()
          and b.status in ('confirmed', 'active', 'completed')
      )
    );
$$;

-- Re-granted because the drop above took the old grants with it.
revoke execute on function public.get_listing_coordinates(uuid) from public, anon;
grant execute on function public.get_listing_coordinates(uuid) to authenticated;
