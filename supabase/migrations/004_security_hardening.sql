-- ============================================================
-- Rentivo — Security Hardening
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- FUNCTIONS: pin search_path on security definer functions
-- ───────────────────────────────────────────────────────────

alter function public.handle_new_user() set search_path = public;

-- System triggers that write to locked-down columns (computed
-- ratings) or rows the acting user doesn't own (availability
-- blocks on cancel) must run with definer rights.
alter function public.recalculate_listing_rating() security definer set search_path = public;
alter function public.recalculate_host_rating() security definer set search_path = public;
alter function public.block_availability_on_confirm() security definer set search_path = public;
alter function public.unblock_availability_on_cancel() security definer set search_path = public;

-- ───────────────────────────────────────────────────────────
-- DATA API GRANTS
-- New Supabase projects do not auto-expose tables to the API
-- roles; every grant below is deliberate. RLS still applies on
-- top of these. Column-level grants block privilege escalation:
--   profiles: no self-granting is_verified / forging ratings
--   bookings: amounts + payment fields are insert-once;
--             payment_status/paymongo_ref are service-role-only
--   reviews:  only rating/comment are editable after posting
-- promo_codes gets no direct access at all (RPC below).
-- ───────────────────────────────────────────────────────────

grant all on all tables in schema public to service_role;

-- Public marketplace reads (anon browsing + logged-in users)
grant select on public.profiles, public.listings,
                public.availability_blocks, public.reviews
  to anon, authenticated;

grant update (full_name, avatar_url, is_host) on public.profiles to authenticated;

grant insert, update, delete on public.listings to authenticated;
grant insert, update, delete on public.availability_blocks to authenticated;

grant select on public.bookings to authenticated;
grant insert (
  listing_id, renter_id, host_id, pickup_date, return_date,
  rental_fee, security_deposit, service_fee, protection_fee, total_amount,
  is_delivery, delivery_address, payment_method, renter_notes
) on public.bookings to authenticated;
grant update (status, host_notes, renter_notes) on public.bookings to authenticated;

grant select, insert on public.messages to authenticated;

grant insert on public.reviews to authenticated;
grant update (rating, comment) on public.reviews to authenticated;

grant select, insert, delete on public.wishlist to authenticated;

-- Booking must target an active public listing whose host matches host_id
drop policy "bookings: renter insert" on public.bookings;
create policy "bookings: renter insert"
  on public.bookings for insert
  with check (
    auth.uid() = renter_id
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.host_id = bookings.host_id
        and l.is_active = true
        and l.is_draft = false
    )
  );

-- Enforce who may move a booking to which status
create or replace function public.enforce_booking_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Service role (webhooks, admin jobs) bypasses transition rules
  if auth.uid() is null then
    return new;
  end if;

  if new.status is distinct from old.status then
    if auth.uid() = old.renter_id then
      -- Renters may only cancel while pending
      if not (old.status = 'pending' and new.status = 'cancelled') then
        raise exception 'Renters can only cancel pending bookings';
      end if;
    elsif auth.uid() = old.host_id then
      if not (
        (old.status = 'pending'   and new.status in ('confirmed', 'cancelled')) or
        (old.status = 'confirmed' and new.status in ('active', 'cancelled')) or
        (old.status = 'active'    and new.status = 'completed')
      ) then
        raise exception 'Invalid booking status transition % -> %', old.status, new.status;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger bookings_enforce_transition
  before update on public.bookings
  for each row execute procedure public.enforce_booking_transition();

-- ───────────────────────────────────────────────────────────
-- REVIEWS: only participants of a completed booking may review
-- the other party, and may later edit only rating/comment.
-- ───────────────────────────────────────────────────────────

drop policy "reviews: reviewer insert" on public.reviews;
create policy "reviews: reviewer insert"
  on public.reviews for insert
  with check (
    auth.uid() = reviewer_id
    and reviewer_id != reviewee_id
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.status = 'completed'
        and (b.renter_id = auth.uid() or b.host_id = auth.uid())
        and (b.renter_id = reviewee_id or b.host_id = reviewee_id)
    )
  );

revoke update on public.reviews from authenticated, anon;
grant update (rating, comment) on public.reviews to authenticated;

-- ───────────────────────────────────────────────────────────
-- PROMO CODES: no direct reads (prevents code enumeration).
-- Checkout validates a single known code via RPC instead.
-- ───────────────────────────────────────────────────────────

drop policy "promo_codes: public read active" on public.promo_codes;

create or replace function public.validate_promo_code(p_code text)
returns table (code text, discount_pct integer, discount_flat integer)
language sql security definer set search_path = public as $$
  select code, discount_pct, discount_flat
  from promo_codes
  where code = p_code
    and is_active = true
    and (valid_from  is null or now() >= valid_from)
    and (valid_until is null or now() <= valid_until)
    and (max_uses    is null or used_count < max_uses)
$$;

revoke execute on function public.validate_promo_code(text) from public, anon;
grant execute on function public.validate_promo_code(text) to authenticated;

-- ───────────────────────────────────────────────────────────
-- STORAGE: create buckets with type/size limits and
-- owner-folder-scoped write policies. Upload paths must be
-- `<auth.uid()>/<filename>`.
-- ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('listing-images',    'listing-images',    true,  10485760, array['image/jpeg','image/png','image/webp','image/avif']),
  ('avatars',           'avatars',           true,   5242880, array['image/jpeg','image/png','image/webp']),
  ('verification-docs', 'verification-docs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "listing-images: public read"
  on storage.objects for select
  using (bucket_id = 'listing-images');

create policy "listing-images: own folder write"
  on storage.objects for insert
  with check (bucket_id = 'listing-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "listing-images: own folder delete"
  on storage.objects for delete
  using (bucket_id = 'listing-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: own folder write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: own folder update"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: own folder delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Verification docs: owner upload + read only; no public access.
-- Reviewed by staff via service role (bypasses RLS).
create policy "verification-docs: own read"
  on storage.objects for select
  using (bucket_id = 'verification-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "verification-docs: own upload"
  on storage.objects for insert
  with check (bucket_id = 'verification-docs' and auth.uid()::text = (storage.foldername(name))[1]);
