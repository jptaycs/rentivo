-- 063: generate_host_bills (061) redefined verbatim with one addition — the
-- bill_issued notification insert, which could not live in 061 because 062
-- adds the enum value and a value cannot be used in the transaction that
-- adds it. Notifications stay written only by security-definer code (012).
-- The grants are re-issued so this file is complete on its own.
create or replace function public.generate_host_bills(p_period date)
returns setof public.host_bills
language plpgsql security definer set search_path = public
as $$
declare
  v_policy_start constant timestamptz := '2026-09-05 00:00+08';
  v_grace        constant interval    := interval '14 days';
  v_min_bill_amount constant integer := 100;  -- PayMongo's minimum charge; smaller sums roll into a later month
  -- Fix round 1, finding 1: `p_period + interval '1 month'` is a timestamp
  -- WITHOUT time zone, so comparing it to `paid_at timestamptz` used the
  -- calling session's TimeZone GUC (UTC for the service-role connection),
  -- not the +08 POLICY_START is anchored to — a booking paid ~03:00 Manila
  -- on the 1st could land on the wrong month depending on who's connected.
  -- Hoisted once here and used in BOTH predicates below so they cannot drift.
  -- Month edges are Manila-local because POLICY_START is.
  v_period_end   constant timestamptz := (p_period + interval '1 month')::timestamp at time zone 'Asia/Manila';
  v_host         uuid;
  v_bill         public.host_bills;
begin
  if p_period is null or p_period <> date_trunc('month', p_period)::date then
    raise exception 'p_period must be the first day of a month.';
  end if;

  for v_host in
    select distinct b.host_id
      from public.bookings b
     where b.payment_method = 'host_qr'
       and b.payment_status = 'paid'
       and b.status <> 'cancelled'
       and b.paid_at >= v_policy_start
       and b.paid_at < v_period_end
       and b.service_fee > 0
       and not exists (select 1 from public.host_bill_items i where i.booking_id = b.id)
       -- Fix round 1, finding 2: only an ACTIVE (non-void) bill for this
       -- period blocks a rerun — a voided bill's slot must be refillable.
       and not exists (
         select 1 from public.host_bills hb
          where hb.host_id = b.host_id and hb.period = p_period and hb.status <> 'void'
       )
  loop
    with eligible as (
      select b.id, b.service_fee
        from public.bookings b
       where b.host_id = v_host
         and b.payment_method = 'host_qr'
         and b.payment_status = 'paid'
         and b.status <> 'cancelled'
         and b.paid_at >= v_policy_start
         and b.paid_at < v_period_end
         and b.service_fee > 0
         and not exists (select 1 from public.host_bill_items i where i.booking_id = b.id)
    ),
    new_bill as (
      insert into public.host_bills (host_id, period, amount, due_at)
      select v_host, p_period, sum(e.service_fee), now() + v_grace
        from eligible e
      having sum(e.service_fee) >= v_min_bill_amount
      on conflict (host_id, period) where status <> 'void' do nothing
      returning *
    ),
    new_items as (
      insert into public.host_bill_items (bill_id, booking_id, amount)
      select nb.id, e.id, e.service_fee from new_bill nb, eligible e
      returning bill_id
    )
    select * into v_bill from new_bill;

    if v_bill.id is not null then
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_bill.host_id,
        'bill_issued',
        'Commission bill for ' || to_char(p_period, 'FMMonth YYYY'),
        '₱' || to_char(v_bill.amount, 'FM999,999,999') || ' for '
          || (select count(*) from public.host_bill_items i where i.bill_id = v_bill.id)
          || ' direct QR booking' || case when (select count(*) from public.host_bill_items i where i.bill_id = v_bill.id) = 1 then '' else 's' end
          || '. Due ' || to_char(v_bill.due_at at time zone 'Asia/Manila', 'FMMonth DD, YYYY') || '.',
        '/dashboard/bills'
      );
      return next v_bill;
    end if;
  end loop;
  return;
end;
$$;

revoke execute on function public.generate_host_bills(date) from public, anon, authenticated;
grant  execute on function public.generate_host_bills(date) to service_role;
