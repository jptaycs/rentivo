-- 067: the only path to a listing's exact coordinates.
--
-- Entitled callers: the listing's host, and a renter with a booking that has
-- reached confirmed. `pending` is excluded deliberately -- an unpaid, unaccepted
-- request must not reveal where the host lives. active/completed are included
-- because a renter mid-rental (or returning gear) still needs the address.
--
-- Returns zero rows rather than raising, so the client renders the approximate
-- view for an unentitled caller instead of showing an error.
create or replace function public.get_listing_coordinates(p_listing_id uuid)
returns table (latitude numeric, longitude numeric)
language sql
security definer
stable
set search_path = public
as $$
  select l.latitude, l.longitude
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

revoke execute on function public.get_listing_coordinates(uuid) from public, anon;
grant execute on function public.get_listing_coordinates(uuid) to authenticated;
