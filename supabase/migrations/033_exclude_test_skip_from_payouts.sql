-- 033_exclude_test_skip_from_payouts.sql
-- A test_skip booking is marked paid without any real charge ever
-- happening — counting it in request_payout()'s eligible-balance CTE
-- would let a host draw a real payout against a booking that involved
-- zero real money. Same exclusion shape as 030's host_qr fix (NULL-safe
-- `is distinct from`, since payment_method is nullable). Byte-identical
-- to 030's request_payout() except this one added predicate.
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
