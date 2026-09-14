-- 076: rate limiting, built in Postgres (no Redis/Upstash, no new service).
--
-- Found by the 2026-09-13 security audit (MEDIUM-4): nothing throttled any
-- write path. Worse, /api/messages/notify emailed the conversation's other
-- party on EVERY call for a given message id, so one message plus a loop
-- was an email bomb sent from noreply@rentivo.live. That is fixed here by
-- messages.notified_at (claimed once, by the service role, in the route) and
-- separately bounded by the route-level limiter below.
--
-- ⚠️ This project grants broad table privileges to anon/authenticated by
-- default (see 016/017), so the new table enables RLS in this migration and
-- revokes everything from both roles explicitly.

-- ── 1. Once-only new-message email ─────────────────────────────────────────
-- Set by POST /api/messages/notify with an atomic
--   update messages set notified_at = now() where id = $1 and notified_at is null
-- via the service-role client; the email is sent only if that update matched
-- a row. No client UPDATE grant: messages keeps `grant update (is_read)` only
-- (053). A client INSERT could still name the column (table-level INSERT is
-- the project's bootstrap grant), so the messages trigger below forces it to
-- null for every non-service-role insert — otherwise a sender could only ever
-- suppress their own email, which is harmless, but the column should mean
-- exactly one thing.
alter table public.messages add column if not exists notified_at timestamptz;
comment on column public.messages.notified_at is
  'When the new-message email for this row was claimed (076). Written only by the service role in /api/messages/notify; at most once.';

-- ── 2. Hit log ─────────────────────────────────────────────────────────────
create table if not exists public.rate_limit_hits (
  key    text        not null,
  hit_at timestamptz not null default now()
);
create index if not exists rate_limit_hits_key_hit_at_idx on public.rate_limit_hits (key, hit_at);

alter table public.rate_limit_hits enable row level security;
-- No policies on purpose: default-deny. Only security-definer code and the
-- service role (account deletion, verification cleanup) touch this table.
revoke all on public.rate_limit_hits from public, anon, authenticated;
grant select, insert, delete on public.rate_limit_hits to service_role;

comment on table public.rate_limit_hits is
  'Sliding-window rate-limit hits (076). key = <scope>:<user id>. Holds user ids — purged by src/lib/account-deletion.ts.';

-- ── 3. The limiter ─────────────────────────────────────────────────────────
-- Atomic under concurrency: the per-key advisory lock serialises every call
-- for one key, so two parallel requests cannot both read "under the limit".
-- The lock is transaction-scoped; each statement below takes a fresh
-- snapshot (plpgsql, volatile), so a waiter sees the previous holder's
-- committed hit once it gets the lock.
--
-- Windows are capped at 24h because the opportunistic global prune deletes
-- anything older than a day — a longer window would have its own history
-- pruned out from under it.
create or replace function public.rate_limit_consume(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_key is null or p_max is null or p_max < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_limit_consume: invalid arguments';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_key));

  delete from public.rate_limit_hits
  where key = p_key
    and hit_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
  from public.rate_limit_hits
  where key = p_key;

  if v_count >= p_max then
    return false;
  end if;

  insert into public.rate_limit_hits (key) values (p_key);

  -- Cheap global prune of abandoned keys: ~1 call in 100, day-old rows only.
  if random() < 0.01 then
    delete from public.rate_limit_hits where hit_at < now() - interval '1 day';
  end if;

  return true;
end;
$$;

revoke all on function public.rate_limit_consume(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_consume(text, integer, integer) to service_role;

-- ── 4. Service-role detection for the trigger exemption ────────────────────
-- auth.uid() is NOT a usable signal: it is null for the service role AND for
-- any session with no JWT. Instead:
--   * auth.role() = 'service_role' — PostgREST sets request.jwt.claims from
--     the verified JWT (the secret key is exchanged for a service_role JWT by
--     the gateway). Inside create_booking (security definer) current_user
--     becomes the owner, but the request claims stay the CALLER's
--     ('authenticated'), so a renter's RPC call is still throttled.
--   * OR no JWT claims at all AND session_user is not 'authenticator' — a
--     direct Postgres connection (migrations, SQL editor, `supabase db
--     query`), which is privileged by definition. Every API request reaches
--     Postgres as session_user 'authenticator', so a request that somehow
--     arrived with no claims is still throttled (fails closed), not exempt.
-- Clients cannot set request.jwt.claims: set_config is not exposed through
-- the Data API.
create or replace function public.rate_limit_is_privileged_session()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.role() is null and session_user <> 'authenticator');
$$;
revoke all on function public.rate_limit_is_privileged_session() from public, anon, authenticated;

-- ── 5. Database-level caps (a direct PostgREST insert cannot bypass these) ──
-- Enforcement by trigger, never by editing create_booking (see 061 and the
-- 038/039 + 040 incidents): create_booking is security definer and inserts
-- into bookings, so this fires on it naturally.

-- bookings: 10 per renter per hour. Every booking writes a notification and
-- can send email; no human rents ten items an hour.
create or replace function public.rate_limit_bookings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.rate_limit_is_privileged_session() then
    return new;
  end if;
  if not public.rate_limit_consume('booking:' || new.renter_id::text, 10, 3600) then
    raise exception 'You have made too many booking requests in the last hour. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.rate_limit_bookings() from public, anon, authenticated;

drop trigger if exists bookings_rate_limit on public.bookings;
create trigger bookings_rate_limit
  before insert on public.bookings
  for each row execute function public.rate_limit_bookings();

-- messages: 30 per sender per minute. Generous for a person typing, a hard
-- ceiling for a script. Covers the composer's direct insert AND create_inquiry.
create or replace function public.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.rate_limit_is_privileged_session() then
    return new;
  end if;
  new.notified_at := null;
  if not public.rate_limit_consume('message:' || new.sender_id::text, 30, 60) then
    raise exception 'You are sending messages too quickly. Please wait a moment and try again.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.rate_limit_messages() from public, anon, authenticated;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.rate_limit_messages();
