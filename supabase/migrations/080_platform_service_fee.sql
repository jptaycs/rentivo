-- 080: admin-controlled platform service fee (spec 2026-09-14 §3; plan 2026-09-14).
--
-- One platform-wide rate in basis points, set by the admin. Each booking stores
-- the rate it was charged at (081 stamps it), so changing the rate never alters
-- a past booking's receipt or a past payout.
--
-- Basis points, not a numeric percentage: 500 = 5.00%. The client mirror is then
-- pure integer arithmetic and the admin form cannot round-trip a float. The
-- 2000 cap is a typo guard (the likeliest mistake is typing 50 for 5.0%), not a
-- business limit — raising it is a one-line migration.

-- ── The setting ────────────────────────────────────────────────────────────
-- Single row: a boolean primary key with `check (id)` makes a second row
-- impossible. RLS enabled here, in the creating migration, with NO policies and
-- every client privilege revoked — this project's bootstrap grants arwd broadly
-- to anon/authenticated on new tables, so "I didn't grant it" is not a defence
-- (AGENTS.md 016/017). Clients read the rate only through
-- current_service_fee_bps().
create table public.platform_settings (
  id              boolean primary key default true check (id),
  service_fee_bps integer not null check (service_fee_bps between 0 and 2000),
  updated_at      timestamptz not null default now()
);

alter table public.platform_settings enable row level security;
revoke all on table public.platform_settings from anon, authenticated;
-- The admin panel reads updated_at off the table with the service-role client.
-- service_role bypasses RLS but NOT grants, so this grant is load-bearing.
grant select on table public.platform_settings to service_role;

-- 5% is the rate in force today (create_booking's `service_fee_rate constant
-- numeric := 0.05` since 035). Seeding it means 081 changes behaviour for
-- nobody on the day it applies.
insert into public.platform_settings (id, service_fee_bps) values (true, 500);

-- ── Per-booking rate ───────────────────────────────────────────────────────
-- Written only by create_booking (081). bookings still carries a table-level
-- SELECT grant to anon/authenticated, so the column is readable under the
-- existing RLS with no new grant; 040's UPDATE column list is
-- (status, host_notes, renter_notes), so it is NOT client-writable. Nullable
-- because the backfill below cannot name a rate for a booking whose fee is
-- ambiguous between 5% and 12% (possible only at a tiny rental; 0 rows today).
alter table public.bookings
  add column service_fee_bps integer check (service_fee_bps between 0 and 2000);

comment on column public.bookings.service_fee_bps is
  'The service-fee rate in basis points that THIS booking was charged at, stamped by create_booking (081). null = a pre-080 booking whose stored fee matches both the 5% and 12% formulas; render it as "Service fee" with no percentage.';

-- Abort rather than guess. A booking whose fee matches neither historical rate
-- would mean a fee history nobody has explained, and a guessed rate printed on
-- a receipt is worse than a stopped migration.
do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from public.bookings
  where service_fee <> round(rental_fee * 0.05)
    and service_fee <> round(rental_fee * 0.12);
  if v_bad > 0 then
    raise exception '080 aborted: % booking(s) have a service_fee matching neither 5%% nor 12%% of rental_fee. Explain them before backfilling.', v_bad;
  end if;
end $$;

update public.bookings
set service_fee_bps = case
  when service_fee =  round(rental_fee * 0.05)
   and service_fee <> round(rental_fee * 0.12) then 500
  when service_fee =  round(rental_fee * 0.12)
   and service_fee <> round(rental_fee * 0.05) then 1200
  else null   -- both formulas agree (tiny rentals); no rate can be named
end;

-- ── admin_actions.target_user_id becomes nullable ──────────────────────────
-- A platform setting has no target user. The index and every existing reader
-- filter by a concrete id, so nothing reads a null.
alter table public.admin_actions alter column target_user_id drop not null;

-- ── RPCs ───────────────────────────────────────────────────────────────────
-- Raises rather than defaulting when the settings row is missing, so
-- create_booking fails CLOSED instead of charging at an unknown rate.
create or replace function public.current_service_fee_bps()
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_bps integer;
begin
  select s.service_fee_bps into v_bps from public.platform_settings s where s.id;
  if v_bps is null then
    raise exception 'The platform service fee is not configured.';
  end if;
  return v_bps;
end;
$$;

-- Function default privileges still grant EXECUTE to PUBLIC in this project
-- (spec §2), so the revoke is mandatory, not tidiness.
revoke all on function public.current_service_fee_bps() from public, anon, authenticated;
grant execute on function public.current_service_fee_bps() to anon, authenticated, service_role;

-- The audit row is written INSIDE this function, not by the route. Existing
-- admin routes insert admin_actions after the RPC returns, which can leave a
-- money change unaudited if the second call fails. This change sets the price
-- every renter pays: the change and its audit commit together or not at all.
create or replace function public.set_service_fee_bps(
  p_bps         integer,
  p_reason      text,
  p_admin_email text
) returns table (previous_bps integer, service_fee_bps integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev   integer;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email  text := nullif(btrim(coalesce(p_admin_email, '')), '');
begin
  if p_bps is null or p_bps < 0 or p_bps > 2000 then
    raise exception 'The service fee must be between 0 and 2000 basis points (0%% and 20%%).';
  end if;
  if v_reason is null then
    raise exception 'A reason is required for a service fee change.';
  end if;
  if v_email is null then
    raise exception 'An admin email is required for a service fee change.';
  end if;

  -- Lock the single row so two admins cannot interleave read-then-write and
  -- write an audit row naming a previous rate that was never current.
  select s.service_fee_bps into v_prev
  from public.platform_settings s
  where s.id
  for update;
  if v_prev is null then
    raise exception 'The platform service fee is not configured.';
  end if;
  if v_prev = p_bps then
    raise exception 'The service fee is already % basis points — nothing to change.', v_prev;
  end if;

  update public.platform_settings s
     set service_fee_bps = p_bps,
         updated_at      = now()
   where s.id;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (
    v_email,
    'service_fee_rate_change',
    null,
    jsonb_build_object('previous_bps', v_prev, 'service_fee_bps', p_bps, 'reason', v_reason)
  );

  return query select v_prev, p_bps;
end;
$$;

revoke all on function public.set_service_fee_bps(integer, text, text) from public, anon, authenticated;
grant execute on function public.set_service_fee_bps(integer, text, text) to service_role;
