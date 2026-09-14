-- 077: booking lifecycle + insert-grant hardening (security audit 2, 2026-09-14).
--
-- Closes the database-side findings of security-audit-2: HIGH-1 (fake
-- reviews), HIGH-2 (double-booking paid dates), MEDIUM-3 (early completion /
-- payout, confirming unpaid bookings), LOW-1..LOW-6 and informational I-1,
-- I-3, I-4. Every one was reproduced live with real anon-key sessions before
-- this migration was written (see the audit's probe scripts).
--
-- Rules this migration keeps, all load-bearing in this repo:
--   * create_booking's body is NOT edited. Every booking rule below is a
--     trigger on bookings (the 038/039 and 040 incidents both came from
--     copying that function).
--   * Column-level grants only mean something after the table-level grant is
--     revoked (040's pattern). Every column list below was read from the real
--     client write sites, named next to each grant — 073 once narrowed a grant
--     without doing that and silently broke host blocked dates in production.
--   * The actor test inside existing triggers stays what it was
--     (auth.uid() is null = service role / direct Postgres connection).

-- ════════════════════════════════════════════════════════════════════════
-- HIGH-2 (a) — confirming a booking must take over any host-owned block row
-- ════════════════════════════════════════════════════════════════════════
-- `on conflict do nothing` left a host's pre-existing 'manual'/'personal' row
-- in place inside the booked range. That row stays host-deletable under 074's
-- "non-booked" policy, and deleting it reopened dates a renter paid for.
-- Relabelling it 'booked' puts it out of the host's reach.
--
-- Accepted side effect: if that booking is later cancelled,
-- unblock_availability_on_cancel removes the row (it deletes 'booked' rows in
-- the range), so the host's original personal block is not restored. The
-- host can re-add it; the alternative (remembering the prior reason) would
-- need new state for a rare case. Checked before applying: no confirmed or
-- active booking currently has a non-'booked' row inside its range, and none
-- is missing a block row, so no backfill is needed.
create or replace function public.block_availability_on_confirm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d date;
begin
  -- Only act when status moves to confirmed or active
  if new.status not in ('confirmed', 'active') then return new; end if;
  if old.status = new.status then return new; end if;

  d := new.pickup_date;
  while d < new.return_date loop
    insert into public.availability_blocks (listing_id, blocked_on, reason)
    values (new.listing_id, d, 'booked')
    -- 077: was `do nothing`, which let a host block survive as a deletable row.
    on conflict (listing_id, blocked_on) do update set reason = 'booked';
    d := d + 1;
  end loop;

  return new;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- HIGH-2 (b) + MEDIUM-3 — enforce_booking_transition
-- ════════════════════════════════════════════════════════════════════════
-- Date convention everywhere below is half-open [pickup_date, return_date),
-- the same as is_listing_available (`blocked_on between p_from and p_to - 1`):
-- the return day is not held, because the renter hands the gear back that
-- morning and the host can re-let it the same day. Two bookings overlap iff
--   a.pickup_date < b.return_date and b.pickup_date < a.return_date
-- so a booking ending on the day another starts does NOT overlap.
--
-- Race safety — why an advisory lock and not an exclusion constraint:
-- Two hosts' sessions (or a host and a webhook) confirming two overlapping
-- bookings hold row locks on DIFFERENT booking rows, so row locking alone
-- lets both "not exists" checks pass. The check therefore takes
-- pg_advisory_xact_lock keyed on the listing before reading. The second
-- confirmer blocks until the first commits; because this function is
-- VOLATILE plpgsql under READ COMMITTED, the EXISTS that follows the lock
-- gets a fresh snapshot and sees the first confirmation, and refuses.
-- An exclusion constraint (btree_gist, `where status in (confirmed, active)`)
-- would be a stronger guarantee against every writer, but it cannot tell the
-- actors apart: it would make mark_booking_paid RAISE when an Instant Book
-- renter pays for a pending request whose dates another booking got confirmed
-- for in the meantime. That happens inside the PayMongo webhook after the
-- renter's money has moved — the booking would stay unpaid with the charge
-- unrecorded, the stranded-payment failure this repo treats as worse than
-- almost anything. The trigger instead records the payment and leaves that
-- booking PENDING (see the privileged branch), so the host sees a paid
-- request they cannot accept, declines it, and the normal refund path runs.
--
-- Lock key: two-int form with class 77 so it cannot share a key with 076's
-- single-int rate-limit locks. Lock ordering: create_booking holds the
-- listing row lock and never takes this lock (inserts don't need it — see
-- guard_booking_insert), and this path never takes the listing row lock, so
-- there is no lock cycle.
create or replace function public.enforce_booking_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- 077: "today" for rental dates is the Philippine calendar day, not UTC's.
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  -- 077: double-booking guard. Runs for EVERY actor, service role included,
  -- whenever a booking starts holding its dates.
  if new.status in ('confirmed', 'active')
     and old.status not in ('confirmed', 'active') then
    perform pg_advisory_xact_lock(77, hashtext(new.listing_id::text));
    if exists (
      select 1
      from public.bookings o
      where o.listing_id = new.listing_id
        and o.id <> new.id
        and o.status in ('confirmed', 'active')
        and o.pickup_date < new.return_date
        and new.pickup_date < o.return_date
    ) then
      if auth.uid() is null then
        -- Service role (mark_booking_paid's Instant Book flip, admin jobs):
        -- never raise — the payment being recorded in this same UPDATE has
        -- already happened. Keep the booking at its previous status instead.
        raise warning 'booking % not moved to %: dates overlap a held booking on listing %',
          new.id, new.status, new.listing_id;
        new.status := old.status;
      else
        raise exception 'These dates are already booked by another confirmed rental.';
      end if;
    end if;
  end if;

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

      -- 077: a host can only accept money that exists. Confirming releases the
      -- exact pickup point and emails the renter "Total paid".
      if new.status = 'confirmed' and new.payment_status is distinct from 'paid' then
        raise exception 'This booking has not been paid yet, so it cannot be confirmed.';
      end if;
      -- 077: a rental cannot start before its pickup day ...
      if new.status = 'active' and v_today < new.pickup_date then
        raise exception 'This rental cannot start before its pickup date (%).', new.pickup_date;
      end if;
      -- ... or finish before its return day (completion makes it payout-eligible).
      if new.status = 'completed' and v_today < new.return_date then
        raise exception 'This rental cannot be completed before its return date (%).', new.return_date;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- HIGH-2 (new bookings over held dates) + LOW-1 (suspended renter) — insert guard
-- ════════════════════════════════════════════════════════════════════════
-- create_booking already refuses dates with availability_blocks rows, but the
-- block rows are derived data; bookings are the source of truth. Pending
-- requests may still overlap each other (the host picks one); only dates held
-- by a confirmed/active booking refuse a new request. No advisory lock here:
-- a new row is always pending, and a pending overlap is allowed, so the worst
-- a race could produce is a pending request the confirm guard above will
-- later refuse to confirm.
--
-- Suspension: create_booking only checks the HOST's suspension. A suspended
-- renter's still-valid access token (up to 1h) could book. is_host_suspended()
-- tests profiles.suspended_at for any user id despite its name.
create or replace function public.guard_booking_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.rate_limit_is_privileged_session()
     and public.is_host_suspended(new.renter_id) then
    raise exception 'Your account is suspended. You cannot make new bookings — contact support.';
  end if;

  if new.status is distinct from 'cancelled' and exists (
    select 1
    from public.bookings o
    where o.listing_id = new.listing_id
      and o.status in ('confirmed', 'active')
      and o.pickup_date < new.return_date
      and new.pickup_date < o.return_date
  ) then
    -- Same wording as create_booking's availability_blocks refusal.
    raise exception 'The selected dates are no longer available.';
  end if;

  return new;
end;
$function$;
revoke all on function public.guard_booking_insert() from public, anon, authenticated;

drop trigger if exists bookings_guard_insert on public.bookings;
create trigger bookings_guard_insert
  before insert on public.bookings
  for each row execute function public.guard_booking_insert();

-- ════════════════════════════════════════════════════════════════════════
-- LOW-3 — each party edits only their own notes
-- ════════════════════════════════════════════════════════════════════════
-- 040 grants UPDATE (status, host_notes, renter_notes) and the RLS policy lets
-- either party update the row, so a renter could overwrite host_notes and
-- vice versa. No app code writes either column today (grep of src/).
create or replace function public.guard_booking_notes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if auth.uid() = old.renter_id and new.host_notes is distinct from old.host_notes then
    raise exception 'Only the host can change the host notes on a booking.';
  end if;
  if auth.uid() = old.host_id and new.renter_notes is distinct from old.renter_notes then
    raise exception 'Only the renter can change the renter notes on a booking.';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_booking_notes() from public, anon, authenticated;

drop trigger if exists bookings_guard_notes on public.bookings;
create trigger bookings_guard_notes
  before update on public.bookings
  for each row execute function public.guard_booking_notes();

-- ════════════════════════════════════════════════════════════════════════
-- MEDIUM-3 — request_payout only pays for rentals whose return day has come
-- ════════════════════════════════════════════════════════════════════════
-- Body copied verbatim from pg_get_functiondef on the live database (which
-- matches 046, the last migration to define it). The ONLY change is the
-- return_date predicate marked 077. The host_qr / test_skip exclusions are
-- kept: host_qr hosts were paid directly by the renter, and dropping that
-- line would pay them a second time.
create or replace function public.request_payout()
returns payout_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account public.payout_accounts;
  v_request public.payout_requests;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  -- 046: suspension must stop money leaving the platform, not just hide gear.
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.suspended_at is not null
  ) then
    raise exception 'Your account is suspended. Payouts are on hold — contact support.';
  end if;

  select * into v_account from public.payout_accounts where user_id = auth.uid();
  if not found or v_account.status != 'verified' then
    raise exception 'You need a verified payout account before requesting a payout.';
  end if;

  if exists (select 1 from public.payout_requests where host_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a payout request in progress.';
  end if;

  with eligible as (
    select b.id, b.rental_fee + b.delivery_fee as payable   -- 038
    from public.bookings b
    where b.host_id = auth.uid()
      and b.status = 'completed'
      and b.payment_status = 'paid'
      and b.return_date <= (now() at time zone 'Asia/Manila')::date   -- 077
      and b.payment_method is distinct from 'host_qr'
      and b.payment_method is distinct from 'test_skip'
      and not exists (
        select 1
        from public.payout_items pi
        join public.payout_requests pr on pr.id = pi.payout_request_id
        where pi.booking_id = b.id and pr.status in ('pending', 'paid')
      )
  ),
  new_request as (
    insert into public.payout_requests (host_id, payout_account_id, amount, status)
    select auth.uid(), v_account.id, coalesce(sum(eligible.payable), 0), 'pending'
    from eligible
    having coalesce(sum(eligible.payable), 0) > 0
    returning *
  ),
  items as (
    insert into public.payout_items (payout_request_id, booking_id, amount)
    select new_request.id, eligible.id, eligible.payable
    from eligible, new_request
    returning *
  )
  select * into v_request from new_request;

  if not found then
    raise exception 'No available balance to pay out.';
  end if;

  return v_request;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- HIGH-1 — reviews
-- ════════════════════════════════════════════════════════════════════════
-- listing_id is DERIVED from the booking, whatever the client sends: the
-- renter's review of the host carries the booking's listing; the host's review
-- of the renter carries NULL. That matches every existing row (the 3 live
-- host-about-renter reviews all have listing_id null, and all 98 others equal
-- their booking's listing). The client still names listing_id in its insert
-- (ReviewModal.tsx sends `listing_id: listingId ?? null`), so the column stays
-- in the insert grant below — the value is simply overwritten here.
create or replace function public.derive_review_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking record;
begin
  select b.listing_id, b.renter_id into v_booking
  from public.bookings b
  where b.id = new.booking_id;

  new.listing_id := case
    when found and new.reviewer_id = v_booking.renter_id then v_booking.listing_id
    else null
  end;
  return new;
end;
$function$;
revoke all on function public.derive_review_listing() from public, anon, authenticated;

drop trigger if exists reviews_derive_listing on public.reviews;
create trigger reviews_derive_listing
  before insert on public.reviews
  for each row execute function public.derive_review_listing();

-- The policy re-states the listing rule (WITH CHECK is evaluated on the row
-- AFTER before-insert triggers, so it holds by construction) and adds the two
-- missing conditions: the booking must be PAID (so a host can't manufacture
-- reviewable bookings), and the reviewer must not be suspended (LOW-1).
drop policy if exists "reviews: reviewer insert" on public.reviews;
create policy "reviews: reviewer insert"
  on public.reviews for insert
  with check (
    auth.uid() = reviewer_id
    and reviewer_id <> reviewee_id
    and not public.is_host_suspended(auth.uid())
    and exists (
      select 1
      from public.bookings b
      where b.id = reviews.booking_id
        and b.status = 'completed'
        and b.payment_status = 'paid'
        and (b.renter_id = auth.uid() or b.host_id = auth.uid())
        and (b.renter_id = reviews.reviewee_id or b.host_id = reviews.reviewee_id)
        and reviews.listing_id is not distinct from
            case when reviews.reviewer_id = b.renter_id then b.listing_id end
    )
  );

-- A listing's rating is the renters' rating of its host for that listing.
-- A host-about-renter review rates a person, not the gear. Checked before
-- applying: every listing's stored rating/review_count already equals this
-- narrower computation, so no recompute of existing rows is needed.
create or replace function public.recalculate_listing_rating()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_listing_id uuid;
begin
  target_listing_id := coalesce(new.listing_id, old.listing_id);
  if target_listing_id is null then return new; end if;

  update public.listings l
  set
    rating       = (select round(avg(r.rating)::numeric, 2) from public.reviews r
                    where r.listing_id = l.id and r.reviewee_id = l.host_id),   -- 077
    review_count = (select count(*) from public.reviews r
                    where r.listing_id = l.id and r.reviewee_id = l.host_id),   -- 077
    updated_at   = now()
  where l.id = target_listing_id;

  return new;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- LOW-2 — reviews / messages: no forged created_at, is_read, notified_at, id
-- ════════════════════════════════════════════════════════════════════════
-- reviews write sites (grep of src/ for from('reviews') .insert):
--   src/components/shared/ReviewModal.tsx:56 — booking_id, reviewer_id,
--   reviewee_id, listing_id, rating, comment. Nothing else inserts reviews
--   under a user session. Excluded: id, created_at.
revoke insert on public.reviews from anon, authenticated;
grant insert (booking_id, reviewer_id, reviewee_id, listing_id, rating, comment)
  on public.reviews to authenticated;

-- messages write sites:
--   src/hooks/useConversation.ts:150 — conversation_id, sender_id, content,
--   image_url (the composer's only insert; `.select()` after it needs SELECT,
--   which is untouched).
--   create_inquiry() inserts (conversation_id, sender_id, content) but is
--   SECURITY DEFINER, so it runs as the function owner and client grants don't
--   apply to it. InquiryDialog.tsx only SELECTs messages.
-- Excluded: id, created_at, is_read, notified_at. 076's messages_rate_limit
-- trigger still fires (grants don't affect triggers) and still nulls
-- notified_at for anything that reaches it.
revoke insert on public.messages from anon, authenticated;
grant insert (conversation_id, sender_id, content, image_url)
  on public.messages to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- LOW-1 — suspended users stop writing even on a still-valid token
-- ════════════════════════════════════════════════════════════════════════
-- is_host_suspended() is SECURITY DEFINER precisely so a policy can call it
-- without depending on what the caller may read from profiles (see 046).
drop policy if exists "messages: participants insert" on public.messages;
create policy "messages: participants insert"
  on public.messages for insert
  with check (
    auth.uid() = sender_id
    and not public.is_host_suspended(auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

-- No separate WITH CHECK, as before: USING doubles as the check. A suspended
-- party's UPDATE therefore matches zero rows (a silent no-op, not an error).
drop policy if exists "bookings: renter or host update" on public.bookings;
create policy "bookings: renter or host update"
  on public.bookings for update
  using (
    (auth.uid() = renter_id or auth.uid() = host_id)
    and not public.is_host_suspended(auth.uid())
  );

drop policy if exists "availability: host manage non-booked" on public.availability_blocks;
create policy "availability: host manage non-booked"
  on public.availability_blocks for all
  to authenticated
  using (
    reason is distinct from 'booked'
    and not public.is_host_suspended(auth.uid())
    and exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  )
  with check (
    reason is distinct from 'booked'
    and not public.is_host_suspended(auth.uid())
    and exists (
      select 1 from public.listings
      where id = listing_id and host_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════════
-- LOW-4 — verification_requests cannot be self-approved at insert
-- ════════════════════════════════════════════════════════════════════════
-- Write sites: src/hooks/useVerification.ts:73 and
-- src/components/host/ListingWizard.tsx:197 — both send exactly user_id,
-- id_doc_path, selfie_path, auto_check_failed, auto_check_detail.
-- review_verification_request() is service-role only and UPDATEs; unaffected.
revoke insert on public.verification_requests from anon, authenticated;
grant insert (user_id, id_doc_path, selfie_path, auto_check_failed, auto_check_detail)
  on public.verification_requests to authenticated;

-- Defence in depth behind the grant: whatever reaches the table from a
-- non-privileged session starts life as an unreviewed pending request.
create or replace function public.force_pending_verification_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.rate_limit_is_privileged_session() then
    return new;
  end if;
  new.status         := 'pending';
  new.reviewer_notes := null;
  new.reviewed_at    := null;
  new.created_at     := now();
  return new;
end;
$function$;
revoke all on function public.force_pending_verification_request() from public, anon, authenticated;

drop trigger if exists verification_requests_force_pending on public.verification_requests;
create trigger verification_requests_force_pending
  before insert on public.verification_requests
  for each row execute function public.force_pending_verification_request();

-- ════════════════════════════════════════════════════════════════════════
-- LOW-5 — cap anonymous view inflation
-- ════════════════════════════════════════════════════════════════════════
-- 120 counted views per listing per hour, then further calls return silently.
-- Why these numbers: at the time of writing every listing's view_count was 0
-- (the marketplace is days old), so 120/hour — a page view every 30 seconds,
-- around the clock, for ONE listing — is far above any organic traffic it will
-- see soon and will not drop real views, while a script can no longer add
-- more than that. If a listing ever genuinely approaches it, raise the number. The window is an hour so a burst of genuine
-- traffic (a shared link) recovers quickly.
--
-- Be honest about what this is: it CAPS inflation, it does not make the
-- counter trustworthy. The key is per listing, not per viewer — Postgres has
-- no reliable client identity for an anonymous call — so one script can still
-- add 120 views an hour to any listing, and by filling the bucket it can also
-- stop real views being counted for the rest of that hour. view_count remains
-- a rough vanity metric. Stays callable by anon: ViewTracker.tsx calls it for
-- guests.
create or replace function public.increment_listing_view(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_listing_id is null then
    return;
  end if;
  if not public.rate_limit_consume('view:' || p_listing_id::text, 120, 3600) then
    return;  -- over the cap: silently not counted
  end if;

  update public.listings l
  set view_count = l.view_count + 1
  where l.id = p_listing_id
    and l.is_active = true
    and l.is_draft = false
    and not exists (
      select 1 from public.profiles p
      where p.id = l.host_id and p.suspended_at is not null
    );
end;
$function$;
revoke all on function public.increment_listing_view(uuid) from public;
grant execute on function public.increment_listing_view(uuid) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- LOW-6 — deleting a listing must not destroy renters' threads
-- ════════════════════════════════════════════════════════════════════════
-- CASCADE let a host erase a renter's copy of an inquiry (and any off-platform
-- payment solicitation in it) by deleting the listing. RESTRICT makes that
-- delete fail with 23503; the host UI (useMyListings.remove and the listing
-- edit page) deactivates the listing instead and tells the host why.
alter table public.conversations drop constraint conversations_listing_id_fkey;
alter table public.conversations
  add constraint conversations_listing_id_fkey
  foreign key (listing_id) references public.listings(id) on delete restrict;

-- ════════════════════════════════════════════════════════════════════════
-- I-1 — TRUNCATE / TRIGGER / REFERENCES / MAINTAIN off the client roles
-- ════════════════════════════════════════════════════════════════════════
-- TRUNCATE ignores RLS. PostgREST cannot issue it, but it is one mistake from
-- reachable. The source of this project's blanket grants is visible in
-- pg_default_acl: role postgres's default privileges in schema public hand
-- anon/authenticated `arwdDxtm` on every new table (the mystery 016/017
-- recorded). This removes the non-DML half for existing tables and for
-- future tables created by postgres (migrations). supabase_admin's own
-- default ACL can't be altered from here; tables it creates are rare.
-- The DML defaults (a/r/w/d) are deliberately left alone: RLS on every table
-- is the documented defence, and changing defaults for DML is its own project.
revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- I-3 — leftover payment-qr-codes storage policies (bucket removed in 072)
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "payment-qr-codes: own folder read"   on storage.objects;
drop policy if exists "payment-qr-codes: own folder write"  on storage.objects;
drop policy if exists "payment-qr-codes: own folder delete" on storage.objects;

-- ════════════════════════════════════════════════════════════════════════
-- I-4 — message image paths must be real UUIDs
-- ════════════════════════════════════════════════════════════════════════
-- 075's `[0-9a-f-]{36}` accepted 36 dashes. The app writes
-- `${userId}/${crypto.randomUUID()}.${ext}` (useConversation.ts), lowercase.
-- Checked before applying: 0 messages carry an image, so validation is free.
-- The sender-folder binding is kept.
alter table public.messages drop constraint messages_image_path_shape;
alter table public.messages
  add constraint messages_image_path_shape check (
    image_url is null
    or (
      image_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp|avif)$'
      and split_part(image_url, '/', 1) = sender_id::text
    )
  );
