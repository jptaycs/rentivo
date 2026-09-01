-- ============================================================
-- 037_gate_listings_on_verification.sql
-- A listing went live the instant it was inserted, regardless of whether
-- the host's ID had been verified. The wizard inserts into `listings`
-- directly (there is no create_listing RPC) and `authenticated` holds
-- insert/update on the table (004), so a client-side gate would be
-- trivially bypassable — enforcement has to live here.
--
-- Reuses the existing `is_draft` column rather than adding new state:
-- every public read path already excludes drafts (RLS 003, create_booking,
-- searchListings, the home/host-profile/detail queries, and
-- increment_listing_view), and "listings: host read own" already lets a
-- host see their own drafts.
-- ============================================================

-- ── 1. Verify the seed/demo hosts FIRST ──────────────────────
-- Four of nineteen hosts are unverified, two of them seed fixtures
-- (Andrei Flores / Google Pixel 9 Pro, Lea Villanueva / Sony 24-70mm).
-- These exist to make the marketplace look populated. Verifying them
-- before the retroactive sweep below is what keeps the storefront intact;
-- reversing this order would pull real seed listings out of search.
update public.profiles
set is_verified = true
where id in (
  'a0000000-0000-4000-8000-000000000012',  -- Andrei Flores
  'a0000000-0000-4000-8000-000000000004',  -- Lea Villanueva
  'a0000000-0000-4000-8000-0000000000ff'   -- Demo User (e2e host)
);

-- ── 2. New listings from unverified hosts start hidden ───────
create or replace function public.force_draft_when_unverified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.host_id and is_verified = true
  ) then
    new.is_draft := true;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_force_draft_when_unverified on public.listings;
create trigger listings_force_draft_when_unverified
  before insert on public.listings
  for each row execute function public.force_draft_when_unverified();

-- ── 3. An unverified host cannot publish their own draft ─────
create or replace function public.block_self_publish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Service role (admin panel, security-definer RPCs, migrations) is exempt,
  -- matching enforce_booking_transition's precedent in 004.
  if auth.uid() is null then
    return new;
  end if;

  if old.is_draft = true and new.is_draft = false then
    if not exists (
      select 1 from public.profiles
      where id = new.host_id and is_verified = true
    ) then
      raise exception 'Your listing goes live once your ID is verified.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_block_self_publish on public.listings;
create trigger listings_block_self_publish
  before update on public.listings
  for each row execute function public.block_self_publish();

-- ── 4. Approving an ID publishes that host's pending listings ─
-- Full body copied from 018's authoritative version; the only addition is
-- the listings update inside the `if p_approve` branch. Note the ordering:
-- is_verified is set BEFORE the listings are published. The trigger above
-- exempts the service role so either order would work, but relying on that
-- bypass rather than on the host genuinely being verified would make this
-- function correct by accident.
create or replace function public.review_verification_request(
  p_request_id uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns public.verification_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.verification_requests;
begin
  update public.verification_requests
  set status         = case when p_approve then 'approved'::verification_status else 'rejected'::verification_status end,
      reviewer_notes = p_notes,
      reviewed_at    = now()
  where id = p_request_id
  returning * into v_request;

  if not found then
    raise exception 'Verification request not found.';
  end if;

  if p_approve then
    update public.profiles set is_verified = true where id = v_request.user_id;

    update public.listings
    set is_draft = false
    where host_id = v_request.user_id and is_draft = true;
  end if;

  return v_request;
end;
$$;

revoke execute on function public.review_verification_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_verification_request(uuid, boolean, text) to service_role;

-- ── 5. Retroactive sweep ─────────────────────────────────────
-- After step 1 this affects only genuinely unverified hosts.
update public.listings l
set is_draft = true
where l.is_draft = false
  and not exists (
    select 1 from public.profiles p
    where p.id = l.host_id and p.is_verified = true
  );
