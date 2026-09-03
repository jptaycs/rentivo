-- 059: close the raw-PostgREST exposure of profiles' private columns.
--
-- Problem (documented since the host-QR work, 2026-09-01): `profiles` has
-- `public read using (true)` AND a table-level SELECT grant to anon and
-- authenticated, so `GET /rest/v1/profiles?select=qr_payment_label` with only
-- the public anon key returned every host's real name + mobile number, and
-- `select=*` returned every column of every user (notification preferences
-- included). The app's own query paths stopped selecting these long ago
-- (PROFILE_COLUMNS), but nothing stopped a direct call.
--
-- Why not narrow the RLS policy: five storefront queries are `!inner` joins on
-- profiles (getFeaturedListings, getPopularListings, getBundles,
-- getActiveListingCount, searchListings). An embed the caller cannot read
-- returns ZERO parent rows, so narrowing the row policy would blank the home
-- page, search and the listing count rather than degrade cosmetically.
--
-- Why column-level grants DO work here: 040 established the shape for UPDATE.
-- A table-level privilege satisfies access to any column, so a column-level
-- grant is meaningless while the table-level one is held — but revoke the
-- table-level grant FIRST and the column list becomes the whole privilege.
-- Same revoke-then-grant order as 040 (profiles/bookings UPDATE) and 053
-- (messages UPDATE), both proven live.
--
-- Consequence to know: `select=*` (and PostgREST embeds written as
-- `profiles(*)`) now fail with 42501 for anon/authenticated, because SELECT *
-- requires privilege on every column. Every app read path already uses an
-- explicit list (PROFILE_COLUMNS, or a single column), except useProfile's
-- own-row `select('*')`, which moves to get_my_profile() below. Any future
-- `profiles(*)` embed run under a user session will 403 — that is the point.
--
-- Public columns (everything PROFILE_COLUMNS ships, plus the two single
-- columns read under a user session outside it):
--   suspended_at   — src/lib/supabase/middleware.ts reads the caller's own
--                    row; it is a boolean-equivalent moderation fact about an
--                    account whose listings have already left the marketplace,
--                    and is_host_suspended() is anon-callable anyway.
--   qr_payment_url — an opaque `<uid>/<uuid>.<ext>` path in a PRIVATE bucket,
--                    useless without a signed URL (only GET /api/bookings/[id]/qr
--                    signs one, for the booking's two parties); Step3Payment
--                    reads it off the listing's host embed to decide whether to
--                    offer the host-QR tile. Deliberately kept.
-- Private (owner + service role only): qr_payment_label, notify_new_booking,
-- notify_messages, notify_reminders, notify_promos, updated_at.
--
-- Replay-safe: revoke/grant are idempotent; the function is create or replace.

revoke select on public.profiles from anon, authenticated;

grant select (
  id, full_name, avatar_url, is_verified, is_host,
  host_rating, host_review_count, response_time_hours,
  created_at, bio, city, suspended_at, qr_payment_url
) on public.profiles to anon, authenticated;

-- The owner's own full row. security definer so it sees every column
-- regardless of the grants above; scoped to auth.uid() so it can never return
-- anyone else's. Returns null (not an error) when signed out or the row is
-- missing, which useProfile already treats as "no profile".
create or replace function public.get_my_profile()
returns public.profiles
language sql
security definer
stable
set search_path = public
as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.get_my_profile() from public, anon;
grant  execute on function public.get_my_profile() to authenticated;
