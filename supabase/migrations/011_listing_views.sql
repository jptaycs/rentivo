-- ============================================================
-- Rentivo — Listing view counter (for host Analytics)
-- A plain counter, not a dedupe'd events log: cheap, and good
-- enough for "how much interest is my listing getting".
-- ============================================================

alter table public.listings add column view_count integer not null default 0;

create or replace function public.increment_listing_view(p_listing_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.listings
  set view_count = view_count + 1
  where id = p_listing_id and is_active = true and is_draft = false;
$$;

revoke execute on function public.increment_listing_view(uuid) from public;
grant execute on function public.increment_listing_view(uuid) to anon, authenticated;
