-- ============================================================
-- Rentivo — Recently-viewed persistence for logged-in users
--
-- Was localStorage-only for everyone (still is, for guests). This
-- table is a thin (user_id, listing_id) reference, not a copy of
-- listing data — reads always join the live listings table, so
-- there's no staleness risk the way the localStorage cache has.
-- Mirrors the wishlist table's shape and RLS exactly.
-- ============================================================

create table public.recently_viewed_listings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  viewed_at   timestamptz not null default now(),

  unique (user_id, listing_id)
);

create index recently_viewed_listings_user_idx on public.recently_viewed_listings(user_id, viewed_at desc);

alter table public.recently_viewed_listings enable row level security;

create policy "recently_viewed_listings: own manage"
  on public.recently_viewed_listings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.recently_viewed_listings to authenticated;
