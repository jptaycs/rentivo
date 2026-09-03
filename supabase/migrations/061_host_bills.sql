-- 061: host commission billing — the ledger.
-- See docs/superpowers/specs/2026-09-04-host-commission-billing-design.md.
--
-- Host-QR bookings put the renter's full total, Rentivo's 5% service fee
-- included, straight into the host's wallet. This ledger bills that fee back
-- monthly. Writes happen only through the three service-role RPCs below;
-- hosts can read their own rows. Enforcement is a BEFORE INSERT trigger on
-- bookings (never an edit to create_booking) driven by an anon-callable
-- security-definer helper, mirroring is_host_suspended() (046).
--
-- Replay-safe throughout.

do $$ begin
  create type public.host_bill_status as enum ('issued', 'paid', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.host_bills (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.profiles(id),
  period        date not null,
  amount        integer not null check (amount > 0),
  status        public.host_bill_status not null default 'issued',
  issued_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  paid_at       timestamptz,
  paymongo_ref  text,
  void_reason   text,
  created_at    timestamptz not null default now()
);
create index if not exists host_bills_host_idx on public.host_bills(host_id, period desc);
-- A voided bill must free its (host_id, period) slot so a correction can be
-- rebilled in the SAME period (fix round 1, finding 2) — so the "one bill per
-- host per period" rule is a PARTIAL unique index over non-void rows, not a
-- table-level UNIQUE. generate_host_bills' ON CONFLICT targets this index.
create unique index if not exists host_bills_active_period_key
  on public.host_bills(host_id, period) where status <> 'void';
-- Two bills must never share a PayMongo intent id; null (unpaid) is exempt.
create unique index if not exists host_bills_paymongo_ref_idx
  on public.host_bills(paymongo_ref) where paymongo_ref is not null;
create index if not exists host_bills_overdue_idx on public.host_bills(host_id) where status = 'issued';

alter table public.host_bills enable row level security;

drop policy if exists "host_bills: own read" on public.host_bills;
create policy "host_bills: own read"
  on public.host_bills for select
  using (auth.uid() = host_id);

revoke all on public.host_bills from anon, authenticated;
grant select on public.host_bills to authenticated;
-- No insert/update/delete grant — writes only via the RPCs below.

create table if not exists public.host_bill_items (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.host_bills(id) on delete cascade,
  booking_id  uuid not null unique references public.bookings(id),
  amount      integer not null check (amount >= 0)
);
create index if not exists host_bill_items_bill_idx on public.host_bill_items(bill_id);

alter table public.host_bill_items enable row level security;

drop policy if exists "host_bill_items: own read" on public.host_bill_items;
create policy "host_bill_items: own read"
  on public.host_bill_items for select
  using (exists (select 1 from public.host_bills b where b.id = bill_id and b.host_id = auth.uid()));

revoke all on public.host_bill_items from anon, authenticated;
grant select on public.host_bill_items to authenticated;

-- ── generate_host_bills ────────────────────────────────────────────────────
-- One bill per host for p_period (first of month). Eligibility (the ONE
-- definition — src/lib/billing.ts only mirrors the policy start date):
--   host_qr, paid, not cancelled, paid_at >= POLICY_START,
--   paid_at < period + 1 month, not already itemized.
-- No lower bound inside the period on purpose: a booking marked paid after
-- its own month was billed is picked up by the next run, not lost. The same
-- roll-forward covers PayMongo's ₱100 minimum charge: a host whose eligible
-- sum falls short simply gets no bill this period, and those bookings stay
-- un-itemized until a later run's sum clears the floor.
-- Idempotent: the partial unique index on (host_id, period) where status <>
-- 'void', plus unique booking_id. Returns only the bills created by THIS
-- call. A void bill's slot is free for a rerun to fill (see the index
-- comment above and void_host_bill's p_rebill=true mode).
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
      return next v_bill;
    end if;
  end loop;
  return;
end;
$$;

revoke execute on function public.generate_host_bills(date) from public, anon, authenticated;
grant  execute on function public.generate_host_bills(date) to service_role;

-- ── mark_host_bill_paid ────────────────────────────────────────────────────
-- Idempotent like mark_booking_paid (009): already-paid returns unchanged.
create or replace function public.mark_host_bill_paid(p_bill_id uuid, p_paymongo_ref text default null)
returns public.host_bills
language plpgsql security definer set search_path = public
as $$
declare v_bill public.host_bills;
begin
  select * into v_bill from public.host_bills where id = p_bill_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_bill.status = 'paid' then return v_bill; end if;
  if v_bill.status = 'void' then raise exception 'Cannot mark a void bill as paid.'; end if;

  update public.host_bills
     set status = 'paid',
         paid_at = now(),
         paymongo_ref = coalesce(p_paymongo_ref, paymongo_ref)
   where id = p_bill_id
  returning * into v_bill;
  return v_bill;
end;
$$;

revoke execute on function public.mark_host_bill_paid(uuid, text) from public, anon, authenticated;
grant  execute on function public.mark_host_bill_paid(uuid, text) to service_role;

-- ── void_host_bill ─────────────────────────────────────────────────────────
-- Admin's only correction/waiver tool, with two distinct modes (fix round 1,
-- finding 2 — the original single mode did neither honestly):
--   p_rebill = true  (default) — CORRECTION. The bill itself was wrong (e.g.
--     issued against the wrong host or amount). Its items are released, so
--     the next generate_host_bills run — even for the SAME period, since a
--     void bill's slot in host_bills_active_period_key is free — bills those
--     bookings again on a fresh bill.
--   p_rebill = false — WAIVER. The bookings really were billed correctly but
--     the host paid Rentivo outside the app (bank transfer, in person, etc).
--     Items stay attached to the voided bill so those bookings are NEVER
--     re-billed by a later run.
-- Paid bills can never be voided either way.
create or replace function public.void_host_bill(p_bill_id uuid, p_reason text, p_rebill boolean default true)
returns public.host_bills
language plpgsql security definer set search_path = public
as $$
declare v_bill public.host_bills;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to void a bill.';
  end if;
  select * into v_bill from public.host_bills where id = p_bill_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_bill.status = 'void' then return v_bill; end if;
  if v_bill.status = 'paid' then raise exception 'A paid bill cannot be voided.'; end if;

  if p_rebill then
    delete from public.host_bill_items where bill_id = p_bill_id;
  end if;
  update public.host_bills
     set status = 'void', void_reason = trim(p_reason)
   where id = p_bill_id
  returning * into v_bill;
  return v_bill;
end;
$$;

drop function if exists public.void_host_bill(uuid, text);
revoke execute on function public.void_host_bill(uuid, text, boolean) from public, anon, authenticated;
grant  execute on function public.void_host_bill(uuid, text, boolean) to service_role;

-- ── is_host_billing_delinquent ─────────────────────────────────────────────
-- security definer so the answer never depends on what the caller may read
-- from host_bills (same reasoning as is_host_suspended, 046).
create or replace function public.is_host_billing_delinquent(p_host_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.host_bills b
     where b.host_id = p_host_id and b.status = 'issued' and b.due_at < now()
  );
$$;

revoke execute on function public.is_host_billing_delinquent(uuid) from public;
grant  execute on function public.is_host_billing_delinquent(uuid) to anon, authenticated;

-- ── enforcement trigger ────────────────────────────────────────────────────
-- A trigger, not an edit to create_booking: that body has been copied across
-- migrations often enough to cause two security incidents (038/039, 040).
create or replace function public.block_delinquent_host_qr()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_method = 'host_qr' and public.is_host_billing_delinquent(new.host_id) then
    raise exception 'This host can''t accept direct QR payments right now. Please choose another payment method.';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_block_delinquent_host_qr on public.bookings;
create trigger bookings_block_delinquent_host_qr
  before insert on public.bookings
  for each row execute function public.block_delinquent_host_qr();
