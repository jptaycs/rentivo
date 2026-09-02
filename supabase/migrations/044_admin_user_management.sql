-- 044_admin_user_management.sql
-- Admin user management: suspension state on profiles, plus an audit trail
-- for the irreversible actions an admin can take on someone else's account.
--
-- NOTE on grants: neither new profiles column is added to 040's `grant update`
-- list. 040 revoked table-level UPDATE on profiles and re-granted exactly the 11
-- columns the app legitimately writes, so anything absent from that list is
-- server/RPC-only by default. That is precisely what we want here — a suspended
-- host must not be able to un-suspend themselves.

alter table public.profiles
  add column if not exists suspended_at      timestamptz,
  add column if not exists suspension_reason text;

-- Partial index: suspensions are rare, so don't carry a full-table index for a
-- column that is almost always null. This backs the visibility predicate in 045.
create index if not exists profiles_suspended_idx
  on public.profiles (suspended_at)
  where suspended_at is not null;

-- Audit trail. target_user_id deliberately has NO foreign key to profiles: a
-- delete action's whole point is that the target may stop being a normal row,
-- and the audit log must never become the reason a future cleanup can't run.
create table if not exists public.admin_actions (
  id             uuid primary key default gen_random_uuid(),
  admin_email    text not null,
  action         text not null,
  target_user_id uuid not null,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_actions_target_idx
  on public.admin_actions (target_user_id, created_at desc);

-- RLS in the same migration that creates the table — mandatory in this project
-- (see the grant-audit finding in AGENTS.md). No policies are added: this table
-- is read and written only by the service-role client, which bypasses RLS, so
-- default-deny is exactly right. The revoke is a second mechanism, not the one
-- that makes it safe.
alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;
