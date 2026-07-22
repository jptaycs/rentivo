-- ============================================================
-- Rentivo — Payout accounts & history
-- Hosts store one payout account (masked in the UI) and request
-- payouts against completed+paid bookings. Actual money movement
-- is manual/admin-run (SQL editor), mirroring verification_requests
-- (015) and mark_booking_refunded (014) — no live disbursement API.
-- ============================================================

create type payout_method as enum (
  'GCash', 'Maya', 'Bank Transfer (Instapay)', 'BDO', 'BPI', 'UnionBank'
);

create type payout_account_status as enum ('pending', 'verified', 'rejected');

create table public.payout_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.profiles(id) on delete cascade,
  method         payout_method not null,
  account_number text not null,
  account_name   text not null,
  status         payout_account_status not null default 'pending',
  reviewer_notes text,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);

alter table public.payout_accounts enable row level security;

create policy "payout_accounts: own read"
  on public.payout_accounts for select
  using (auth.uid() = user_id);

grant select on public.payout_accounts to authenticated;
-- No insert/update/delete grant — writes only via set_payout_account() below.

create type payout_status as enum ('pending', 'paid', 'failed');

create table public.payout_requests (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid not null references public.profiles(id) on delete cascade,
  payout_account_id uuid not null references public.payout_accounts(id),
  amount            integer not null,
  status            payout_status not null default 'pending',
  reference         text,
  notes             text,
  requested_at      timestamptz not null default now(),
  processed_at      timestamptz
);

create unique index payout_requests_one_pending_per_host
  on public.payout_requests(host_id) where status = 'pending';

create index payout_requests_host_idx on public.payout_requests(host_id, requested_at desc);

alter table public.payout_requests enable row level security;

create policy "payout_requests: own read"
  on public.payout_requests for select
  using (auth.uid() = host_id);

grant select on public.payout_requests to authenticated;
-- No insert/update/delete grant — writes only via request_payout()/mark_payout_* below.

create table public.payout_items (
  payout_request_id uuid not null references public.payout_requests(id) on delete cascade,
  booking_id         uuid not null references public.bookings(id),
  amount             integer not null,
  primary key (payout_request_id, booking_id)
);

alter table public.payout_items enable row level security;

create policy "payout_items: own read"
  on public.payout_items for select
  using (
    exists (
      select 1 from public.payout_requests pr
      where pr.id = payout_request_id and pr.host_id = auth.uid()
    )
  );

grant select on public.payout_items to authenticated;
-- No insert/update/delete grant — written only inside request_payout() below.

-- ───────────────────────────────────────────────────────────
-- set_payout_account — the only write path to payout_accounts.
-- Upserts on user_id, always resetting status to 'pending' so a
-- replaced account must be re-verified before it can receive a
-- payout. Uses auth.uid() internally — never a passed-in id.
-- ───────────────────────────────────────────────────────────

create or replace function public.set_payout_account(
  p_method         payout_method,
  p_account_number text,
  p_account_name   text
)
returns public.payout_accounts
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;
  if length(trim(p_account_number)) = 0 or length(trim(p_account_name)) = 0 then
    raise exception 'Account number and name are required.';
  end if;

  insert into public.payout_accounts (user_id, method, account_number, account_name, status, reviewer_notes, reviewed_at)
  values (auth.uid(), p_method, trim(p_account_number), trim(p_account_name), 'pending', null, null)
  on conflict (user_id) do update
    set method         = excluded.method,
        account_number = excluded.account_number,
        account_name   = excluded.account_name,
        status         = 'pending',
        reviewer_notes = null,
        reviewed_at    = null
  returning * into v_account;

  return v_account;
end;
$$;

revoke execute on function public.set_payout_account(payout_method, text, text) from public, anon;
grant execute on function public.set_payout_account(payout_method, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────
-- request_payout — itemizes eligible completed+paid bookings not
-- already claimed by a pending/paid request into a new payout
-- request. Operates only on auth.uid().
-- ───────────────────────────────────────────────────────────

create or replace function public.request_payout()
returns public.payout_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_request public.payout_requests;
  v_amount  integer;
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

  select coalesce(sum(b.rental_fee), 0) into v_amount
  from public.bookings b
  where b.host_id = auth.uid()
    and b.status = 'completed'
    and b.payment_status = 'paid'
    and not exists (
      select 1
      from public.payout_items pi
      join public.payout_requests pr on pr.id = pi.payout_request_id
      where pi.booking_id = b.id and pr.status in ('pending', 'paid')
    );

  if v_amount = 0 then
    raise exception 'No available balance to pay out.';
  end if;

  insert into public.payout_requests (host_id, payout_account_id, amount, status)
  values (auth.uid(), v_account.id, v_amount, 'pending')
  returning * into v_request;

  insert into public.payout_items (payout_request_id, booking_id, amount)
  select v_request.id, b.id, b.rental_fee
  from public.bookings b
  where b.host_id = auth.uid()
    and b.status = 'completed'
    and b.payment_status = 'paid'
    and not exists (
      select 1
      from public.payout_items pi
      join public.payout_requests pr on pr.id = pi.payout_request_id
      where pi.booking_id = b.id and pr.status in ('pending', 'paid')
    );

  return v_request;
end;
$$;

revoke execute on function public.request_payout() from public, anon;
grant execute on function public.request_payout() to authenticated;

-- ───────────────────────────────────────────────────────────
-- Admin-only, service-role — run manually from the SQL editor,
-- mirroring review_verification_request (015) and
-- mark_booking_refunded (014).
-- ───────────────────────────────────────────────────────────

create or replace function public.review_payout_account(
  p_account_id uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns public.payout_accounts
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
begin
  update public.payout_accounts
  set status         = case when p_approve then 'verified' else 'rejected' end,
      reviewer_notes = p_notes,
      reviewed_at    = now()
  where id = p_account_id
  returning * into v_account;

  if not found then
    raise exception 'Payout account not found.';
  end if;

  return v_account;
end;
$$;

revoke execute on function public.review_payout_account(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_payout_account(uuid, boolean, text) to service_role;

create or replace function public.mark_payout_paid(
  p_request_id uuid,
  p_reference  text default null
)
returns public.payout_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.payout_requests;
begin
  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout request not found.';
  end if;

  if v_request.status = 'paid' then
    return v_request;  -- idempotent — a retried call is a no-op
  end if;
  if v_request.status != 'pending' then
    raise exception 'Only pending payout requests can be marked paid.';
  end if;

  update public.payout_requests
  set status       = 'paid',
      reference    = coalesce(p_reference, reference),
      processed_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke execute on function public.mark_payout_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_payout_paid(uuid, text) to service_role;

create or replace function public.mark_payout_failed(
  p_request_id uuid,
  p_notes      text default null
)
returns public.payout_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.payout_requests;
begin
  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout request not found.';
  end if;

  if v_request.status = 'failed' then
    return v_request;  -- idempotent — a retried call is a no-op
  end if;
  if v_request.status != 'pending' then
    raise exception 'Only pending payout requests can be marked failed.';
  end if;

  update public.payout_requests
  set status       = 'failed',
      notes        = coalesce(p_notes, notes),
      processed_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke execute on function public.mark_payout_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_payout_failed(uuid, text) to service_role;
