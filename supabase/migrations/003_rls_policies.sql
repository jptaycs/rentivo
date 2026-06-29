-- ============================================================
-- Rentivo — Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles          enable row level security;
alter table public.listings          enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.bookings          enable row level security;
alter table public.messages          enable row level security;
alter table public.reviews           enable row level security;
alter table public.wishlist          enable row level security;
alter table public.promo_codes       enable row level security;

-- ───────────────────────────────────────────────────────────
-- PROFILES
-- ───────────────────────────────────────────────────────────

-- Anyone can read profiles (public marketplace)
create policy "profiles: public read"
  on public.profiles for select using (true);

-- Users can only update their own profile
create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

-- ───────────────────────────────────────────────────────────
-- LISTINGS
-- ───────────────────────────────────────────────────────────

-- Anyone can browse active, non-draft listings
create policy "listings: public read active"
  on public.listings for select
  using (is_active = true and is_draft = false);

-- Hosts can see all their own listings (incl. drafts/paused)
create policy "listings: host read own"
  on public.listings for select
  using (auth.uid() = host_id);

-- Authenticated users can create listings
create policy "listings: authenticated insert"
  on public.listings for insert
  with check (auth.uid() = host_id);

-- Hosts can update/delete their own listings
create policy "listings: host update"
  on public.listings for update
  using (auth.uid() = host_id);

create policy "listings: host delete"
  on public.listings for delete
  using (auth.uid() = host_id);

-- ───────────────────────────────────────────────────────────
-- AVAILABILITY BLOCKS
-- ───────────────────────────────────────────────────────────

-- Anyone can read blocked dates (needed for calendar)
create policy "availability: public read"
  on public.availability_blocks for select using (true);

-- Hosts can manage their own listing's availability
create policy "availability: host manage"
  on public.availability_blocks for all
  using (
    exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────
-- BOOKINGS
-- ───────────────────────────────────────────────────────────

-- Renters see their own bookings; hosts see bookings for their listings
create policy "bookings: renter or host read"
  on public.bookings for select
  using (auth.uid() = renter_id or auth.uid() = host_id);

-- Authenticated renters can create bookings
create policy "bookings: renter insert"
  on public.bookings for insert
  with check (auth.uid() = renter_id);

-- Renters can cancel pending bookings; hosts can confirm/complete
create policy "bookings: renter or host update"
  on public.bookings for update
  using (auth.uid() = renter_id or auth.uid() = host_id);

-- ───────────────────────────────────────────────────────────
-- MESSAGES
-- ───────────────────────────────────────────────────────────

-- Only booking participants can read messages
create policy "messages: participants read"
  on public.messages for select
  using (
    exists (
      select 1 from public.bookings
      where id = booking_id
        and (renter_id = auth.uid() or host_id = auth.uid())
    )
  );

-- Participants can send messages
create policy "messages: participants insert"
  on public.messages for insert
  with check (
    auth.uid() = sender_id and
    exists (
      select 1 from public.bookings
      where id = booking_id
        and (renter_id = auth.uid() or host_id = auth.uid())
    )
  );

-- ───────────────────────────────────────────────────────────
-- REVIEWS
-- ───────────────────────────────────────────────────────────

-- Reviews are public
create policy "reviews: public read"
  on public.reviews for select using (true);

-- Only the reviewer can write their own review
create policy "reviews: reviewer insert"
  on public.reviews for insert
  with check (auth.uid() = reviewer_id);

-- Reviewers can update their own reviews within 48h (enforced in app layer)
create policy "reviews: reviewer update"
  on public.reviews for update
  using (auth.uid() = reviewer_id);

-- ───────────────────────────────────────────────────────────
-- WISHLIST
-- ───────────────────────────────────────────────────────────

-- Users manage only their own wishlist
create policy "wishlist: own manage"
  on public.wishlist for all
  using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────
-- PROMO CODES
-- ───────────────────────────────────────────────────────────

-- Anyone can read active promo codes (for validation)
create policy "promo_codes: public read active"
  on public.promo_codes for select
  using (is_active = true);

-- ───────────────────────────────────────────────────────────
-- STORAGE BUCKETS
-- Run after creating buckets in Supabase Dashboard
-- ───────────────────────────────────────────────────────────

-- Create buckets via Dashboard first, then uncomment:
/*
insert into storage.buckets (id, name, public) values
  ('listing-images', 'listing-images', true),
  ('avatars', 'avatars', true),
  ('verification-docs', 'verification-docs', false);  -- private

-- Listing images: authenticated upload, public read
create policy "listing-images: public read"
  on storage.objects for select
  using (bucket_id = 'listing-images');

create policy "listing-images: auth upload"
  on storage.objects for insert
  with check (bucket_id = 'listing-images' and auth.role() = 'authenticated');

-- Avatars: public read, own upload/update
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: own upload"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Verification docs: private — only owner and service_role
create policy "verification-docs: own read"
  on storage.objects for select
  using (bucket_id = 'verification-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "verification-docs: own upload"
  on storage.objects for insert
  with check (bucket_id = 'verification-docs' and auth.uid()::text = (storage.foldername(name))[1]);
*/
