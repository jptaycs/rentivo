-- 082: admin-issued payout statements (spec 2026-09-14 §6-§7; plan 2026-09-14).
--
-- A payout_requests row IS the statement. Its lifecycle:
--   pending                          = draft (bookings and amount fixed, money not sent)
--   paid + statement_number          = issued (the admin recorded the transfer)
--   failed, no number                = cancelled draft
--   failed, number, reversed_at set  = reversed issued statement
-- payout_status keeps its three values: reversal is a COLUMN, not a fourth enum
-- value, so no isolated enum migration is needed and every existing
-- `status = 'paid'` reader (reports' Payouts Paid) automatically stops counting
-- a reversed payout.
--
-- A separate payout_statements table was rejected: these tables already itemize
-- bookings per payout and already carry the "one booking claimed once" rule. A
-- second table would duplicate that rule — the drift this repo has paid for
-- repeatedly.

-- ── Guard ──────────────────────────────────────────────────────────────────
-- The backfill below numbers existing paid requests and snapshots their
-- accounts. Abort unless the row counts match what was measured at authoring,
-- so it never runs against a state nobody looked at.
do $$
declare v_paid integer; v_pending integer; v_failed integer;
begin
  select count(*) filter (where status = 'paid'),
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'failed')
    into v_paid, v_pending, v_failed
  from public.payout_requests;
  if v_paid <> 1 or v_pending <> 0 or v_failed <> 0 then
    raise exception '082 aborted: payout_requests is (paid %, pending %, failed %); authored against (1, 0, 0). Re-read the rows and re-check the backfill before applying.', v_paid, v_pending, v_failed;
  end if;
end $$;

-- ── payout_requests: statement columns ─────────────────────────────────────
-- The account is SNAPSHOTTED onto the draft because set_payout_account
-- rewrites the row a draft points at (048). The statement must record where the
-- money was actually sent, and the admin must transfer to the details the draft
-- fixed.
alter table public.payout_requests
  add column statement_number     text unique check (statement_number ~ '^PS-[0-9]{4}-[0-9]{6}$'),
  add column account_method       public.payout_method,
  add column account_name         text,
  add column account_number       text,
  add column transferred_on       date,
  add column reversed_at          timestamptz,
  add column reversal_reason      text,
  add column statement_emailed_at timestamptz;

-- ── payout_items: per-booking snapshot ─────────────────────────────────────
-- A statement is a document. It must not change when a host renames a listing
-- or an account is anonymized. No renter name is stored — the booking reference
-- identifies the booking without putting a counterparty's identity on the
-- host's paper.
alter table public.payout_items
  add column booking_ref     text,
  add column listing_title   text,
  add column pickup_date     date,
  add column return_date     date,
  add column rental_fee      integer,
  add column delivery_fee    integer,
  add column service_fee     integer,
  add column service_fee_bps integer;

update public.payout_items pi
set booking_ref     = b.booking_ref,
    listing_title   = coalesce(l.title, 'Deleted listing'),
    pickup_date     = b.pickup_date,
    return_date     = b.return_date,
    rental_fee      = b.rental_fee,
    delivery_fee    = b.delivery_fee,
    service_fee     = b.service_fee,
    service_fee_bps = b.service_fee_bps
from public.bookings b
left join public.listings l on l.id = b.listing_id
where pi.booking_id = b.id;

do $$
begin
  if exists (select 1 from public.payout_items where booking_ref is null) then
    raise exception '082 aborted: a payout_item has no matching booking row';
  end if;
  if exists (select 1 from public.payout_items where amount <> rental_fee + delivery_fee) then
    raise exception '082 aborted: a payout_item amount does not equal rental_fee + delivery_fee';
  end if;
end $$;

alter table public.payout_items
  alter column booking_ref   set not null,
  alter column listing_title set not null,
  alter column pickup_date   set not null,
  alter column return_date   set not null,
  alter column rental_fee    set not null,
  alter column delivery_fee  set not null,
  alter column service_fee   set not null,
  add constraint payout_items_amount_matches check (amount = rental_fee + delivery_fee);

-- ── Backfill payout_requests ───────────────────────────────────────────────
-- The linked payout_accounts row is the only record of where the money went
-- for a legacy request; for the one legacy row it is the demo account.
update public.payout_requests pr
set account_method = pa.method,
    account_name   = pa.account_name,
    account_number = pa.account_number
from public.payout_accounts pa
where pa.id = pr.payout_account_id;

update public.payout_requests
set transferred_on = (processed_at at time zone 'Asia/Manila')::date
where status = 'paid' and processed_at is not null;

-- Number paid requests in processed_at order within their Manila year. The one
-- legacy row becomes PS-2026-000001, so the first REAL statement is 000002 —
-- honest, since that row is genuinely recorded as paid.
with numbered as (
  select id,
         extract(year from (processed_at at time zone 'Asia/Manila'))::integer as yr,
         row_number() over (
           partition by extract(year from (processed_at at time zone 'Asia/Manila'))
           order by processed_at, id
         ) as n
  from public.payout_requests
  where status = 'paid'
)
update public.payout_requests pr
set statement_number = 'PS-' || numbered.yr::text || '-' || lpad(numbered.n::text, 6, '0')
from numbered
where numbered.id = pr.id;

-- ── Statement numbering ────────────────────────────────────────────────────
-- Gapless per Manila calendar year, assigned AT ISSUE, from a counter row —
-- NOT a sequence. A Postgres sequence is not transactional: a rolled-back issue
-- burns a number, so a sequence cannot be gapless. A counter row incremented
-- inside the issuing transaction is gapless by construction (a rollback undoes
-- the increment), and its row lock serializes two concurrent issues. Assigned
-- at issue, not at draft, so a cancelled draft never consumes a number; a
-- reversed statement keeps its number, so the series never skips and never
-- reuses.
create table public.payout_statement_counters (
  year        integer primary key check (year between 2026 and 2100),
  last_number integer not null check (last_number >= 0)
);

alter table public.payout_statement_counters enable row level security;
revoke all on table public.payout_statement_counters from anon, authenticated;
grant select on table public.payout_statement_counters to service_role;

insert into public.payout_statement_counters (year, last_number)
select extract(year from (processed_at at time zone 'Asia/Manila'))::integer, count(*)
from public.payout_requests
where status = 'paid' and statement_number is not null
group by 1;

-- ── Invariants, added AFTER the backfill ───────────────────────────────────
alter table public.payout_requests
  add constraint payout_requests_paid_complete check (
    status <> 'paid' or (
      statement_number is not null and reference is not null and transferred_on is not null
      and account_method is not null and account_name is not null and account_number is not null
    )),
  add constraint payout_requests_pending_unnumbered check (
    status <> 'pending' or statement_number is null),
  add constraint payout_requests_reversal_shape check (
    reversed_at is null or (
      status = 'failed' and statement_number is not null and reversal_reason is not null
    )),
  add constraint payout_requests_number_only_when_issued check (
    statement_number is null or status = 'paid' or reversed_at is not null);

-- ── Table-level write grants ───────────────────────────────────────────────
-- Every writer is a security-definer RPC (re-checked by grep in the plan). Only
-- RLS default-deny stops a client write today; this makes it a privilege check,
-- which cannot be undone by an unrelated policy edit.
revoke insert, update, delete on public.payout_accounts  from anon, authenticated;
revoke insert, update, delete on public.payout_requests  from anon, authenticated;
revoke insert, update, delete on public.payout_items     from anon, authenticated;

-- ── Eligibility: ONE definition ────────────────────────────────────────────
-- Body is request_payout's CTE predicate verbatim plus the host filter. The
-- host_qr and test_skip exclusions STAY: those bookings were paid straight into
-- the host's own wallet, never through Rentivo, so paying them out would pay
-- that host a second time out of Rentivo's funds. A `failed` request releases
-- its bookings (only 'pending' and 'paid' exclude), matching request_payout.
--
-- language sql on purpose: in a SQL function the OUT columns are not visible as
-- variables, so `host_id` in the WHERE clause is unambiguously the booking's
-- column. The same body in plpgsql would be ambiguous.
create or replace function public.payout_eligible_bookings(p_host_id uuid default null)
returns table (booking_id uuid, host_id uuid, payable integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.host_id, (b.rental_fee + b.delivery_fee)::integer
  from public.bookings b
  where (p_host_id is null or b.host_id = p_host_id)
    and b.status = 'completed'
    and b.payment_status = 'paid'
    and b.return_date <= (now() at time zone 'Asia/Manila')::date          -- 077
    and b.payment_method is distinct from 'host_qr'                        -- 029
    and b.payment_method is distinct from 'test_skip'                      -- 033
    and not exists (
      select 1
      from public.payout_items pi
      join public.payout_requests pr on pr.id = pi.payout_request_id
      where pi.booking_id = b.id and pr.status in ('pending', 'paid')
    );
$$;

-- Internal. No client grant at all: a null p_host_id returns EVERY host's
-- bookings, so this must never be reachable from a session.
revoke all on function public.payout_eligible_bookings(uuid) from public, anon, authenticated;

create or replace function public.payouts_owed(p_host_id uuid default null)
returns table (host_id uuid, bookings integer, amount integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.host_id, count(*)::integer, sum(e.payable)::integer
  from public.payout_eligible_bookings(p_host_id) e
  group by e.host_id;
$$;

revoke all on function public.payouts_owed(uuid) from public, anon, authenticated;
grant execute on function public.payouts_owed(uuid) to service_role;

-- ⚠️ The null check is load-bearing, not defensive tidiness. auth.uid() is null
-- for an unauthenticated caller, and payout_eligible_bookings(null) returns
-- EVERY host's eligible bookings — so without this raise, an anon call would
-- return the platform-wide balance. plpgsql (not sql) exists purely so the
-- guard can run before the query.
create or replace function public.my_payout_balance()
returns table (bookings integer, amount integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated.';
  end if;
  return query
    select coalesce(count(*), 0)::integer, coalesce(sum(e.payable), 0)::integer
    from public.payout_eligible_bookings(v_uid) e;
end;
$$;

revoke all on function public.my_payout_balance() from public, anon;
grant execute on function public.my_payout_balance() to authenticated, service_role;

-- ── Lifecycle: prepare a draft ─────────────────────────────────────────────
create or replace function public.create_payout_statement(
  p_host_id         uuid,
  p_expected_amount integer,
  p_admin_email     text
) returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.payout_accounts;
  v_request public.payout_requests;
  v_total   integer;
  v_count   integer;
  v_email   text := nullif(btrim(coalesce(p_admin_email, '')), '');
begin
  if v_email is null then
    raise exception 'An admin email is required.';
  end if;
  if p_host_id is null then
    raise exception 'A host is required.';
  end if;
  if p_expected_amount is null or p_expected_amount <= 0 then
    raise exception 'An expected amount is required.';
  end if;

  -- Serializes two admins, or two clicks from one. The unique
  -- payout_requests_one_pending_per_host index is the backstop, not the guard.
  perform pg_advisory_xact_lock(hashtext('payout-statement:' || p_host_id::text));

  if not exists (select 1 from public.profiles where id = p_host_id) then
    raise exception 'Host not found.';
  end if;
  if exists (select 1 from public.profiles where id = p_host_id and suspended_at is not null) then
    raise exception 'Payouts are on hold — reinstate the host first.';
  end if;

  select * into v_account from public.payout_accounts where user_id = p_host_id;
  if not found or v_account.status <> 'verified' then
    raise exception 'This host has no verified payout account.';
  end if;

  if exists (select 1 from public.payout_requests where host_id = p_host_id and status = 'pending') then
    raise exception 'This host already has a draft payout statement. Record or cancel it first.';
  end if;

  insert into public.payout_requests (
    host_id, payout_account_id, amount, status,
    account_method, account_name, account_number
  ) values (
    p_host_id, v_account.id, 0, 'pending',
    v_account.method, v_account.account_name, v_account.account_number
  ) returning * into v_request;

  -- The draft exists but has no items yet, so it excludes nothing from
  -- eligibility here.
  insert into public.payout_items (
    payout_request_id, booking_id, amount,
    booking_ref, listing_title, pickup_date, return_date,
    rental_fee, delivery_fee, service_fee, service_fee_bps
  )
  select v_request.id, e.booking_id, e.payable,
         b.booking_ref, coalesce(l.title, 'Deleted listing'), b.pickup_date, b.return_date,
         b.rental_fee, b.delivery_fee, b.service_fee, b.service_fee_bps
  from public.payout_eligible_bookings(p_host_id) e
  join public.bookings b on b.id = e.booking_id
  left join public.listings l on l.id = b.listing_id;

  -- Sum WHAT WAS INSERTED, not a separate earlier read: a booking completing
  -- concurrently then cannot make the stored amount and the items disagree.
  select count(*)::integer, coalesce(sum(amount), 0)::integer
    into v_count, v_total
  from public.payout_items
  where payout_request_id = v_request.id;

  if v_total = 0 then
    raise exception 'This host has nothing owed right now.';
  end if;
  if v_total <> p_expected_amount then
    raise exception 'The amount owed changed from % to % — reload and check.', p_expected_amount, v_total;
  end if;

  update public.payout_requests set amount = v_total where id = v_request.id
  returning * into v_request;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (v_email, 'payout_statement_draft', p_host_id,
    jsonb_build_object('payout_request_id', v_request.id, 'amount', v_total, 'bookings', v_count));

  return v_request;
end;
$$;

revoke all on function public.create_payout_statement(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.create_payout_statement(uuid, integer, text) to service_role;

-- ── Lifecycle: issue ───────────────────────────────────────────────────────
-- A suspended host does NOT block issuing: the admin may already have sent the
-- money, and refusing to record a real transfer is worse than recording it
-- (the mark_booking_paid reasoning). The admin page shows the suspension badge.
create or replace function public.issue_payout_statement(
  p_request_id     uuid,
  p_reference      text,
  p_transferred_on date,
  p_admin_email    text
) returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payout_requests;
  v_ref     text    := nullif(btrim(coalesce(p_reference, '')), '');
  v_email   text    := nullif(btrim(coalesce(p_admin_email, '')), '');
  v_year    integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
  v_today   date    := (now() at time zone 'Asia/Manila')::date;
  v_n       integer;
begin
  if v_email is null then
    raise exception 'An admin email is required.';
  end if;
  if v_ref is null then
    raise exception 'A transfer reference is required.';
  end if;
  if length(v_ref) > 100 then
    raise exception 'The transfer reference must be 100 characters or fewer.';
  end if;

  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout statement not found.';
  end if;

  -- Idempotent on the SAME reference; refuses a different one, because that
  -- would silently rewrite the money trail of a transfer already recorded.
  if v_request.status = 'paid' then
    if v_request.reference = v_ref then
      return v_request;
    end if;
    raise exception 'This statement was already issued with reference %.', v_request.reference;
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a draft can be issued.';
  end if;

  if p_transferred_on is null then
    raise exception 'A transfer date is required.';
  end if;
  if p_transferred_on > v_today then
    raise exception 'The transfer date cannot be in the future.';
  end if;
  if p_transferred_on < (v_request.requested_at at time zone 'Asia/Manila')::date then
    raise exception 'The transfer date cannot be before the draft was prepared.';
  end if;

  -- Gapless: the upsert's row lock serializes concurrent issues, and a
  -- rollback undoes the increment.
  insert into public.payout_statement_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update
    set last_number = public.payout_statement_counters.last_number + 1
  returning last_number into v_n;

  update public.payout_requests
     set status           = 'paid',
         statement_number = 'PS-' || v_year::text || '-' || lpad(v_n::text, 6, '0'),
         reference        = v_ref,
         transferred_on   = p_transferred_on,
         processed_at     = now()
   where id = p_request_id
  returning * into v_request;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (v_email, 'payout_statement_issue', v_request.host_id,
    jsonb_build_object(
      'payout_request_id', v_request.id,
      'statement_number',  v_request.statement_number,
      'amount',            v_request.amount,
      'reference',         v_ref,
      'transferred_on',    p_transferred_on
    ));

  return v_request;
end;
$$;

revoke all on function public.issue_payout_statement(uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.issue_payout_statement(uuid, text, date, text) to service_role;

-- ── Lifecycle: cancel a draft ──────────────────────────────────────────────
-- No email: the host never received anything. Releases the bookings, because
-- the eligibility predicate ignores `failed`.
create or replace function public.cancel_payout_statement(
  p_request_id  uuid,
  p_reason      text,
  p_admin_email text
) returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payout_requests;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email   text := nullif(btrim(coalesce(p_admin_email, '')), '');
begin
  if v_email is null then
    raise exception 'An admin email is required.';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to cancel a draft.';
  end if;

  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout statement not found.';
  end if;

  if v_request.status = 'failed' and v_request.statement_number is null then
    return v_request;   -- already cancelled
  end if;
  if v_request.statement_number is not null then
    raise exception 'This statement was already issued — reverse it instead.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a draft can be cancelled.';
  end if;

  update public.payout_requests
     set status = 'failed', notes = v_reason, processed_at = now()
   where id = p_request_id
  returning * into v_request;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (v_email, 'payout_statement_cancel', v_request.host_id,
    jsonb_build_object('payout_request_id', v_request.id, 'amount', v_request.amount, 'reason', v_reason));

  return v_request;
end;
$$;

revoke all on function public.cancel_payout_statement(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_payout_statement(uuid, text, text) to service_role;

-- ── Lifecycle: reverse an issued statement ─────────────────────────────────
-- Releases the bookings, so the host is owed again. THIS CAN DOUBLE-PAY if the
-- transfer actually arrived — mitigated by the route requiring the admin to
-- type the statement number, and by the required reason. Not prevented.
create or replace function public.reverse_payout_statement(
  p_request_id  uuid,
  p_reason      text,
  p_admin_email text
) returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payout_requests;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email   text := nullif(btrim(coalesce(p_admin_email, '')), '');
begin
  if v_email is null then
    raise exception 'An admin email is required.';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to reverse a statement.';
  end if;

  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout statement not found.';
  end if;

  if v_request.reversed_at is not null then
    return v_request;   -- already reversed
  end if;
  if v_request.statement_number is null then
    raise exception 'This is a draft, not an issued statement — cancel it instead.';
  end if;
  if v_request.status <> 'paid' then
    raise exception 'Only an issued statement can be reversed.';
  end if;

  update public.payout_requests
     set status          = 'failed',
         reversed_at     = now(),
         reversal_reason = v_reason
   where id = p_request_id
  returning * into v_request;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (v_email, 'payout_statement_reverse', v_request.host_id,
    jsonb_build_object(
      'payout_request_id', v_request.id,
      'statement_number',  v_request.statement_number,
      'amount',            v_request.amount,
      'reason',            v_reason
    ));

  return v_request;
end;
$$;

revoke all on function public.reverse_payout_statement(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reverse_payout_statement(uuid, text, text) to service_role;

-- ── The old functions, stubbed ─────────────────────────────────────────────
-- In the minutes between applying this migration and the app deploy, an old
-- admin tab must not be able to issue a paid request with no statement number,
-- and an old host tab must not create an un-snapshotted draft. CREATE OR
-- REPLACE keeps their existing grants; 083 drops all three once the new app is
-- live. Return types confirmed live: all three return payout_requests.
--
-- ⚠️ mark_payout_paid and mark_payout_failed carry `default null` on their
-- second parameter LIVE (pg_get_function_arguments, not
-- pg_get_function_identity_arguments, is what shows this). CREATE OR REPLACE
-- cannot remove a parameter default — "cannot remove parameter defaults from
-- existing function" (42P13), which is exactly how this was found: the first
-- apply aborted on it and the whole migration rolled back. The defaults are
-- reproduced below so the signature is byte-identical and the existing ACL
-- survives.
create or replace function public.request_payout()
returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Payouts now use statements — reload the page.';
end;
$$;

create or replace function public.mark_payout_paid(p_request_id uuid, p_reference text default null)
returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Payouts now use statements — reload the page.';
end;
$$;

create or replace function public.mark_payout_failed(p_request_id uuid, p_notes text default null)
returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Payouts now use statements — reload the page.';
end;
$$;
