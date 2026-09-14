-- 079: hardening follow-ups from security audit 2 (I-2, I-6), closing the
-- default-privileges gap behind 016/017, and a rate limit on
-- quote_delivery_fee (078's deferred Minor).
--
-- create_booking is NOT touched here (038/039, 040). Every function below is
-- redefined from its LIVE body captured with pg_get_functiondef on 2026-09-14,
-- changing only what each section's comment names. CREATE OR REPLACE keeps a
-- function's existing ACL, so no grants are re-issued.

-- ── 1. Storage object keys may not contain a `..` path segment (I-2) ──────────
-- Storage accepted `<uid>/../<other uid>/x.png` and stored it literally. No read
-- bypass followed (every policy compares storage.foldername(name)[1], which is
-- still the caller's own uid), but a key that *looks* like it escapes its folder
-- is one careless path join away from a real confusion. Each policy below is the
-- live one with every existing condition kept — especially the <uid>/ folder
-- binding — plus the segment check. Only whole `..` segments are refused, so a
-- file named `a..b.png` still uploads. 0 existing objects matched at authoring.
do $$
begin
  if exists (select 1 from storage.objects where name ~ '(^|/)\.\.(/|$)') then
    raise exception '079 aborted: an existing storage object key contains a .. segment';
  end if;
end $$;

drop policy if exists "listing-images: own folder write" on storage.objects;
create policy "listing-images: own folder write" on storage.objects
  for insert with check (
    bucket_id = 'listing-images'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and name !~ '(^|/)\.\.(/|$)'
  );

drop policy if exists "avatars: own folder write" on storage.objects;
create policy "avatars: own folder write" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and name !~ '(^|/)\.\.(/|$)'
  );

-- The only UPDATE policy on storage.objects (uploadAvatar uses upsert). USING is
-- the live condition unchanged; WITH CHECK was implicit (= USING) and is now
-- explicit with the segment check, so an update can't rename INTO such a key.
drop policy if exists "avatars: own folder update" on storage.objects;
create policy "avatars: own folder update" on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and name !~ '(^|/)\.\.(/|$)'
  );

drop policy if exists "verification-docs: own upload" on storage.objects;
create policy "verification-docs: own upload" on storage.objects
  for insert with check (
    bucket_id = 'verification-docs'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and name !~ '(^|/)\.\.(/|$)'
  );

drop policy if exists "message-images: own folder write" on storage.objects;
create policy "message-images: own folder write" on storage.objects
  for insert with check (
    bucket_id = 'message-images'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and name !~ '(^|/)\.\.(/|$)'
  );

-- ── 2. handle_new_user keeps only a trusted avatar_url (I-6) ─────────────────
-- raw_user_meta_data is client-controlled at signup (supabase.auth.signUp's
-- options.data), so a signup could plant any string — an arbitrary tracking
-- URL, a javascript: URI — as the avatar every counterparty's browser loads.
-- Kept only when it is an https URL on Google's avatar host (Google OAuth) or
-- this project's own public storage path; null otherwise. The host must be
-- followed immediately by `/`, which also defeats `host.evil.com` and
-- `host@evil.com` tricks. Existing profiles are untouched (24 rows at
-- authoring: 19 null, 4 Google, 1 own storage — all already inside the rule).
-- Live body otherwise verbatim.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_avatar text := new.raw_user_meta_data->>'avatar_url';  -- 079
begin
  -- 079: only a trusted https avatar host survives.
  if v_avatar is null or v_avatar !~ '^https://(lh3\.googleusercontent\.com|prfizruuqwvteqovuqco\.supabase\.co/storage/v1/object/public)/[^\s"''<>\\]*$' then
    v_avatar := null;
  end if;

  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    v_avatar
  );
  return new;
end;
$function$;

-- ── 3. New tables are no longer client-readable/writable by default ──────────
-- pg_default_acl gave anon/authenticated `arwd` on every table role postgres
-- creates in public — the source of 016/017's "mystery" grants. 077 removed
-- only D/x/t/m. After this, a table a future migration creates holds NO client
-- privileges until that migration grants them, so a forgotten grant fails as a
-- visible 403 rather than silently leaving a world-writable table. Existing
-- tables are unaffected (default privileges apply at creation time only).
-- service_role keeps its defaults. RLS in the creating migration stays
-- mandatory regardless.
--
-- supabase_admin's matching default ACL (still arwdDxtm to anon/authenticated)
-- CANNOT be changed here: `alter default privileges for role supabase_admin`
-- fails with 42501 "permission denied to change default privileges", because
-- postgres is not a member of supabase_admin. It only affects objects the
-- platform creates as supabase_admin, never this repo's migrations.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

-- ── 4. Rate-limit quote_delivery_fee (078 deferred Minor) ────────────────────
-- Called as a renter drags a delivery pin; the client debounces at 350ms, so
-- 120 quotes per 10 minutes is far above a person and a ceiling for a script.
-- Live body verbatim except: (a) the limiter at the top; (b) STABLE -> VOLATILE,
-- because the limiter writes a hit row and PostgREST runs STABLE functions in a
-- read-only transaction, where that insert would fail. The service role (no
-- auth.uid()) is not limited — rate_limit_consume refuses a null key.
CREATE OR REPLACE FUNCTION public.quote_delivery_fee(p_listing_id uuid, p_delivery_lat numeric, p_delivery_lng numeric)
 RETURNS TABLE(fee integer, road_km integer)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_listing record;
begin
  -- 079
  if auth.uid() is not null
     and not public.rate_limit_consume('quote:' || auth.uid()::text, 120, 600) then
    raise exception 'Too many delivery quotes — please wait a moment.';
  end if;

  select l.delivery_fee, l.delivery_fee_per_km, l.location_is_exact, l.approx_latitude, l.approx_longitude
    into v_listing
  from public.listings l
  where l.id = p_listing_id and l.is_active and not l.is_draft
    and not public.is_host_suspended(l.host_id);
  if not found then
    raise exception 'Listing not found or no longer available.';
  end if;
  if v_listing.delivery_fee is null then
    raise exception 'This host does not offer delivery.';
  end if;
  return query
    select q.fee, q.road_km
    from public.delivery_fee_for(v_listing.delivery_fee, v_listing.delivery_fee_per_km,
      v_listing.location_is_exact, v_listing.approx_latitude, v_listing.approx_longitude,
      p_delivery_lat, p_delivery_lng) q;
end;
$function$;
