-- ============================================================
-- 046_suspension_hardening.sql
-- Three gaps left by 045, all found in review.
--
-- 1. 045's RLS predicate fails OPEN. A subquery inside a policy's USING clause
--    runs with the INVOKER's privileges, so `profiles`' own RLS applies to it.
--    Today `profiles: public read` is `using (true)`, so anon resolves the
--    `not exists (... suspended_at is not null)` correctly. But if that policy
--    is ever narrowed — which AGENTS.md's To Do explicitly contemplates, for the
--    qr_payment_label exposure — the subquery would return zero rows for anon,
--    `not exists` would become true, and every suspended host's listings would
--    silently return to the marketplace with no error anywhere. A security
--    definer helper makes the answer independent of the caller's view of
--    profiles, so the failure mode becomes "cannot happen" rather than "depends
--    on a policy in another file".
--
-- 2. request_payout() still pays a suspended host. Suspension that doesn't stop
--    money leaving the platform isn't suspension.
--
-- 3. (app code, not this file) an unpaid pre-suspension booking could still be
--    charged via /api/payments/checkout's booking-reuse path.
-- ============================================================

-- ── 1. Suspension helper ─────────────────────────────────────────
-- `stable`, not `volatile`. Do NOT read this as a caching guarantee: a
-- `security definer` function is never inlined, and STABLE only lets the
-- planner reuse a result across rows when the ARGUMENTS are constant. Here the
-- argument is `listings.host_id`, which varies per row, so this is invoked once
-- per candidate row regardless. STABLE is still the correct label — the
-- function reads only committed table data and has no side effects, so
-- mislabelling it `volatile` would needlessly forbid optimisations elsewhere.
-- (Corrected in 047's round; the original wording claimed a per-statement cache
-- that does not apply to a per-row argument.)
create or replace function public.is_host_suspended(p_host_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_host_id and p.suspended_at is not null
  );
$$;

revoke execute on function public.is_host_suspended(uuid) from public;
grant execute on function public.is_host_suspended(uuid) to anon, authenticated;

-- ── 2. Listings public read, via the helper ──────────────────────
-- Same drop+create shape as 045. Only the suspension term changes: the inline
-- subquery becomes the helper call.
drop policy if exists "listings: public read active" on public.listings;
create policy "listings: public read active"
  on public.listings for select
  using (
    is_active = true
    and is_draft = false
    and not public.is_host_suspended(listings.host_id)
  );

-- increment_listing_view (045) and create_booking (045) are deliberately NOT
-- switched to the helper. Both are already `security definer`, so their inline
-- subqueries execute as the function owner and cannot be affected by a change
-- to profiles' RLS — the failure mode this migration exists to remove does not
-- apply to them. Rewriting them would mean reproducing create_booking's body a
-- second time, and every such reproduction is a chance to disturb the amounts
-- logic that has already caused two security incidents in this repo. The
-- inconsistency is the cheaper risk.

-- ── 3. request_payout ────────────────────────────────────────────
-- Body copied verbatim from 038 (the latest of the six migrations that define
-- this function: 020, 021, 029, 030, 033, 038). The ONLY change is the
-- suspension guard marked "046:", inserted after the authentication check.
-- Unlike create_booking's guard, this exception names the reason: the caller
-- is the suspended host themselves, not a stranger, so there is nothing to
-- disclose that they don't already know.
create or replace function public.request_payout()
returns public.payout_requests
language plpgsql security definer set search_path = public
as $$
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
$$;
