-- ============================================================
-- Rentivo — Fix request_payout() race condition
-- The original 020 version computed the payout amount and the
-- itemized booking list via two separate SELECTs, leaving a
-- window (under READ COMMITTED) where a booking's completed/paid
-- state could change between them — a booking could get claimed
-- into payout_items without being counted in the amount. This
-- rewrite computes both from a single `eligible` CTE inside one
-- atomic WITH query, so Postgres guarantees exactly one snapshot
-- shared by both inserts. Mirrors 018's "fix via new migration,
-- create or replace function" precedent.
-- ============================================================

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

  select * into v_account from public.payout_accounts where user_id = auth.uid();
  if not found or v_account.status != 'verified' then
    raise exception 'You need a verified payout account before requesting a payout.';
  end if;

  if exists (select 1 from public.payout_requests where host_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a payout request in progress.';
  end if;

  with eligible as (
    select b.id, b.rental_fee
    from public.bookings b
    where b.host_id = auth.uid()
      and b.status = 'completed'
      and b.payment_status = 'paid'
      and not exists (
        select 1
        from public.payout_items pi
        join public.payout_requests pr on pr.id = pi.payout_request_id
        where pi.booking_id = b.id and pr.status in ('pending', 'paid')
      )
  ),
  new_request as (
    insert into public.payout_requests (host_id, payout_account_id, amount, status)
    select auth.uid(), v_account.id, coalesce(sum(eligible.rental_fee), 0), 'pending'
    from eligible
    having coalesce(sum(eligible.rental_fee), 0) > 0
    returning *
  ),
  items as (
    insert into public.payout_items (payout_request_id, booking_id, amount)
    select new_request.id, eligible.id, eligible.rental_fee
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
