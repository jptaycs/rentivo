# Admin-controlled service fee and admin-issued payout statements — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin set Rentivo's service-fee rate from the admin panel, stamp the rate each booking was charged at onto the booking row, and replace host-requested payouts with admin-issued, numbered payout statements that hosts can read, print and receive by email.

**Architecture:** Two independent phases.

*Phase B* puts one platform-wide rate in a single-row `platform_settings` table read by `current_service_fee_bps()`. `create_booking` reads that rate **once** and uses it twice — to compute the fee and to stamp `bookings.service_fee_bps` — so a receipt can never disagree with what was charged. Every client-side percentage becomes a value read from the server (`getServiceFeeBps()` on the server, `useServiceFeeBps()` in host-facing client copy), and the existing checkout **409 `total_changed`** path absorbs a rate change that lands mid-checkout with no new code path.

*Phase C* makes a `payout_requests` row *be* the statement rather than adding a parallel ledger: `pending` = draft, `paid` + `statement_number` = issued, `failed` = cancelled (no number) or reversed (number kept + `reversed_at`). The payout account and every per-booking figure are **snapshotted** onto the draft, so the document does not change when a host renames a listing or replaces an account. Eligibility — today duplicated in `request_payout`'s CTE, `getUnrequestedPayouts()` and a third, wrong copy in `usePayoutRequests().availableBalance` — collapses into one SQL function, `payout_eligible_bookings()`. Statement numbers are gapless per Manila calendar year, taken from a counter row inside the issuing transaction (a sequence cannot be gapless — a rolled-back issue burns a number).

**Tech Stack:** Next.js 16 App Router (React 19), Supabase Postgres + RLS, PayMongo, Resend, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-14-admin-service-fee-and-payout-statements-design.md` — its decisions are binding. This plan executes it; it does not revisit it.

**Phase order:** Phase B ships and deploys **first and alone**. Phase C starts only after B is deployed (it snapshots the per-booking rate B introduces). The end of Phase B is marked explicitly below.

---

## Global Constraints

Every task's requirements implicitly include these.

- **`create_booking` is never edited by hand-writing a body.** It has caused three incidents here (038/039 resurrecting a revoked grant, 040's table-level write hole, 073's production break under a green suite). The only permitted procedure is: capture the live body with `pg_get_functiondef`, apply **exactly** the four hunks in spec §4.1 (reproduced in Task B3), use `CREATE OR REPLACE` with the **unchanged signature and return type** so the existing ACL survives, and carry the md5 guard. Never copy the body from a migration file. Never drop and re-create it in this work.
  - The live definition captured at authoring (2026-09-14):
    `md5(pg_get_functiondef(oid))` = **`ec309539300d75e69a905942b49fa484`**
    signature = `(p_listing_id uuid, p_pickup_date date, p_return_date date, p_is_delivery boolean, p_delivery_address text, p_payment_method payment_method, p_renter_notes text, p_promo_code text, p_delivery_lat numeric, p_delivery_lng numeric)`, returns `bookings`, `SECURITY DEFINER`, `SET search_path TO 'public'`, ACL `postgres, authenticated, service_role` = EXECUTE.
- **Every new table enables RLS in the migration that creates it.** `alter table ... enable row level security;` in the same statement block. This project's bootstrap grants `arwd` broadly to `anon`/`authenticated` on tables created by `postgres`/`supabase_admin`, so a table without RLS is world-writable the moment it exists (AGENTS.md ⚠️ 016/017). Migration 079 revoked `postgres`'s default table privileges, but `supabase_admin`'s default ACL cannot be altered from a migration — do not rely on "I didn't grant it".
- **Every new function revokes EXECUTE explicitly.** Function default privileges still grant `EXECUTE` to `PUBLIC` (spec §2). Every `create function` in this plan is followed by `revoke all on function … from public, anon, authenticated;` and then the grants it actually needs. A function with no explicit revoke is callable by anonymous visitors.
- **Never touch** host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` or booking `RNT-A4DA55`. Read-only checks of both at the end of every verification script; any modification is a failed run.
- **Throwaway accounts are `@example.com`.** Every probe row is deleted and then **re-read** to prove it is gone. Baselines (`bookings`, `payout_requests`, `payout_items`, `payout_accounts`, `admin_actions`, `notifications`, `listings`, `profiles`) are counted before and after each script and must match.
- **`RESEND_API_KEY` must be blank** in the environment for every verification run, so no probe or real user receives mail. `src/lib/email.ts`'s `send()` logs `[email] RESEND_API_KEY not set — skipped …` and returns; that log line is the assertion.
- **Servers run on port 3100** (3101 if 3100 is occupied). Never 3000 — it serves an unrelated project of the owner's. Kill by PID from `lsof -t -iTCP:<port>`; `pkill -f "next start"` matches nothing because `npm start` execs into `next-server (vX)`, and a silent `EADDRINUSE` leaves the OLD bundle serving, which produces false negatives.
- **Migrations are numbered from 080.** 079 is the highest applied (`supabase migration list --linked`, confirmed 2026-09-14). Apply with `supabase db push --linked --yes`, then confirm with `supabase migration list --linked` — ignore pg-delta cert noise after "Applying migration…".
- **No local database exists.** Every migration applies to production. Anything that must not commit runs as a rolled-back probe (Task B2 Step 1 defines the technique).
- Every task ends with `npx tsc --noEmit && npm run lint && npm run build` clean. `npm run lint` currently emits one pre-existing `<img>` warning in `src/components/dashboard/BillPayModal.tsx`; that one warning is the accepted baseline.
- One commit per task, imperative summary.

---

# PHASE B — admin-controlled service fee

Ships and deploys on its own. Migrations 080 and 081.

---

### Task B1: Migration 080 — the setting, the per-booking rate, and the two RPCs

**Files:**
- Create: `supabase/migrations/080_platform_service_fee.sql`

**Interfaces:**
- Produces table `public.platform_settings (id boolean pk, service_fee_bps integer, updated_at timestamptz)`, exactly one row, seeded `500`.
- Produces column `public.bookings.service_fee_bps integer` (nullable, `check between 0 and 2000`), backfilled.
- Produces `public.current_service_fee_bps() returns integer` — `stable`, `security definer`, EXECUTE to `anon, authenticated, service_role`.
- Produces `public.set_service_fee_bps(p_bps integer, p_reason text, p_admin_email text) returns table (previous_bps integer, service_fee_bps integer)` — `security definer`, EXECUTE to `service_role` only.
- Alters `public.admin_actions.target_user_id` to nullable.
- Consumed by: Task B2 (verification), Task B3 (`create_booking` reads `current_service_fee_bps()`), Task B5 (`getServiceFeeBps`), Task B8 (`set_service_fee_bps` from the admin route).

- [ ] **Step 1: Re-confirm the live state this migration assumes**

```bash
cd /Users/jptaycs/Documents/GitHub/rentivo
supabase db query --linked "select count(*) filter (where service_fee = round(rental_fee*0.05)) as at5, count(*) filter (where service_fee = round(rental_fee*0.12)) as at12, count(*) filter (where service_fee <> round(rental_fee*0.05) and service_fee <> round(rental_fee*0.12)) as neither, count(*) as total from public.bookings;"
```

At authoring: `at5 = 6`, `at12 = 13`, `neither = 0`, `total = 19`. `at5` may have grown (every new booking is at 5%). **`neither` must be 0** — if it is not, stop and report: the migration's abort guard would fire and a rate nobody has explained must be understood before any backfill runs.

- [ ] **Step 2: Write `supabase/migrations/080_platform_service_fee.sql`**

```sql
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
```

- [ ] **Step 3: Apply**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

Expected: `080` present locally and remotely.

- [ ] **Step 4: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add supabase/migrations/080_platform_service_fee.sql
git commit -m "Add an admin-settable platform service fee (migration 080)"
```

---

### Task B2: `scripts/verify/080-platform-service-fee.mjs`

**Files:**
- Create: `scripts/verify/080-platform-service-fee.mjs`

**Interfaces:**
- Consumes: everything Task B1 produces.
- Produces: the **rolled-back SQL probe helper** pattern that Tasks B4, B6 and C2 reuse. Written inline in each script (these scripts are deliberately standalone `.mjs` files using only `./env.mjs`); B4 and C2 copy the `probe()` function from here verbatim.

- [ ] **Step 1: Establish the rolled-back-probe technique**

Anything that must not commit runs as one `supabase db query --linked` call wrapping a `do $$ … $$` block that ends by raising, so the whole transaction rolls back and the script parses the JSON out of the error text.

```js
import { execFileSync } from 'node:child_process'

/**
 * Run SQL inside a transaction that is GUARANTEED to roll back.
 *
 * The block must end with `raise exception 'VERIFY %', <jsonb or text>;`.
 * The raise aborts the transaction, so nothing it wrote survives; we read the
 * results out of the error message. This is how a rate change or a statement
 * number gets exercised on production without committing one.
 *
 * `claims` sets request.jwt.claims LOCAL (third arg true), so auth.uid() and
 * auth.role() inside the probe answer as that user and the setting dies with
 * the transaction.
 */
function probe(sql, claims = null) {
  const preamble = claims
    ? `perform set_config('request.jwt.claims', ${JSON.stringify(JSON.stringify(claims)).replace(/'/g, "''")}, true);`
    : ''
  const body = `do $$\nbegin\n${preamble}\n${sql}\nend $$;`
  try {
    execFileSync('supabase', ['db', 'query', '--linked', body], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { raised: false, payload: null, error: null }
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`
    const m = text.match(/VERIFY (.*)/)
    return { raised: true, payload: m ? m[1].trim() : null, error: text }
  }
}
```

**Every script using `probe()` must first prove the harness, before trusting any result from it:**

1. `probe("perform set_config('request.jwt.claims', …, true); raise exception 'VERIFY %', auth.uid();", { sub: <probe uid>, role: 'authenticated' })` → the payload equals the probe uid. If it does not, the claims plumbing is broken and every authorisation result from a probe is meaningless.
2. A probe that writes a sentinel row (`insert into public.admin_actions (admin_email, action, target_user_id, detail) values ('probe@example.com','probe_rollback_sentinel',null,'{}'::jsonb);`) and then raises; afterwards, a service-role read proves **no** `probe_rollback_sentinel` row exists. If it does exist, the probe is not rolling back and no further probe may be run.

- [ ] **Step 2: Write the script**

`scripts/verify/080-platform-service-fee.mjs`, header comment stating what it proves, `import { admin, asUser, signIn, check, done } from './env.mjs'`. Uses `admin()` only for setup, independent re-reads and cleanup; a real signed-in session for every authorisation claim. Checks, each refusal paired with its control (spec §14, rows for 080):

1. **Harness proof** — the two probe checks in Step 1.
2. **`platform_settings` is closed to clients** — anon `GET /rest/v1/platform_settings?select=*` → `401`/`permission denied`; a signed-in throwaway user's same `GET` → `permission denied for table platform_settings`. **Control:** service role reads the one row and it holds `service_fee_bps = 500`.
3. **`current_service_fee_bps()` is open** — anon `POST /rest/v1/rpc/current_service_fee_bps` → `200` with body `500`. **Control pairing for check 2:** the rate is readable by everyone through the RPC while the table is not.
4. **`set_service_fee_bps` is service-role only** — a signed-in throwaway user calling it → `permission denied for function set_service_fee_bps`; anon → `401` (no JWT, so PostgREST rejects before the grant list — assert the distinction, do not treat 401 and 403 as interchangeable). **Control:** inside a rolled-back probe, `select * from public.set_service_fee_bps(600, 'probe', 'probe@example.com')` succeeds and, in the same probe, `select count(*) from public.admin_actions where action = 'service_fee_rate_change'` is 1 — proving the audit row is written in the same transaction. After the probe, a service-role read proves `platform_settings.service_fee_bps` is still `500` and no `service_fee_rate_change` row exists.
5. **Validation refusals**, each inside its own rolled-back probe as service role: `2001` → raises "between 0 and 2000"; `-1` → raises; `null` → raises; `500` (the current value, a no-op) → raises "already 500 basis points"; a blank/whitespace reason at a valid 600 → raises "A reason is required"; a blank admin email → raises. **Control:** `2000` with a real reason and email succeeds inside a probe (proving the cap is inclusive and the refusals above are attributable to their own branch).
6. **The per-booking column is not client-writable** — the demo renter (`renter@demo.rentivo.ph`) `PATCH /rest/v1/bookings?id=eq.<their own booking>` with `{"service_fee_bps": 0}` → `permission denied for table bookings`. **Control:** the same session's `PATCH` of `{"renter_notes": "<probe>"}` on the same row → `204`, then restored to its original value (captured first).
7. **The per-booking column IS readable by a party** — that same renter's `GET /rest/v1/bookings?id=eq.<id>&select=service_fee_bps` → `200` and the value is `500` or `1200` (not an error).
8. **Backfill is self-consistent** — service-role read of every booking's `(rental_fee, service_fee, service_fee_bps)`; for each row assert `service_fee === Math.floor((rental_fee * service_fee_bps + 5000) / 10000)` when `service_fee_bps` is non-null, and when it is null assert `round(rental_fee*0.05) === round(rental_fee*0.12)` (the only reason a rate cannot be named). Report the counts — at authoring `500 × 6`, `1200 × 13`, `null × 0`.
9. **`admin_actions.target_user_id` is nullable** — `information_schema.columns` says `is_nullable = 'YES'`. Read through a service-role PostgREST query against an exposed view is not available for `information_schema`; use `supabase db query --linked` for this one check and parse the JSON.
10. **Baseline and forbidden rows** — booking/`admin_actions`/`platform_settings` counts identical to the pre-run capture; host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` and booking `RNT-A4DA55` re-read and byte-identical to their pre-run snapshot.

Cleanup: delete the throwaway user, its profile row and any `rate_limit_hits` row with `key like '%:<uid>'`; re-read each to prove it is gone.

- [ ] **Step 3: Run**

```bash
RESEND_API_KEY= node --experimental-strip-types scripts/verify/080-platform-service-fee.mjs
```

Expected: all checks pass. A failure here blocks Task B3 — do not apply 081 against an unverified 080.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/080-platform-service-fee.mjs
git commit -m "Verify the platform service fee setting and its grants"
```

---

### Task B3: Migration 081 — `create_booking` reads and stamps the rate

**Files:**
- Create: `supabase/migrations/081_create_booking_service_fee_bps.sql`
- Create (scratch, not committed): `/tmp/create_booking_live.sql`

**Interfaces:**
- Consumes: `public.current_service_fee_bps()` and `public.bookings.service_fee_bps` (Task B1).
- Produces: `create_booking` with an **unchanged** signature, return type and ACL, that reads the rate once and writes `service_fee_bps` on every new booking.
- Consumed by: Task B4 (verification), Task B5 (`StoredBookingAmounts.service_fee_bps`).

- [ ] **Step 1: Capture the live body and prove the hash**

```bash
cd /Users/jptaycs/Documents/GitHub/rentivo
supabase db query --linked "select md5(pg_get_functiondef(p.oid)) as def_md5, pg_get_function_result(p.oid) as result, (select string_agg(grantee||':'||privilege_type, ',' order by grantee) from information_schema.routine_privileges rp where rp.routine_schema='public' and rp.routine_name='create_booking') as grants from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_booking';"
supabase db query --linked "select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_booking';"
```

Expected, and **required before proceeding**:
- `def_md5` = `ec309539300d75e69a905942b49fa484`
- `result` = `bookings`
- `grants` = `authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE`

If `def_md5` differs, **stop**: someone has changed the function since this plan was authored. Re-read the new body, re-derive the four hunks against it by hand, update the guard's hash in Step 2, and record the change in the commit message. Do not proceed on the assumption that the hunks still apply.

Write the `def` value (the JSON string, unescaped) to `/tmp/create_booking_live.sql`. `pg_get_functiondef` emits a complete `CREATE OR REPLACE FUNCTION …` statement, so this file is the starting point for Step 2 — not a reference to retype from.

- [ ] **Step 2: Write `supabase/migrations/081_create_booking_service_fee_bps.sql`**

The file is, in order: the header comment, the guard, then `/tmp/create_booking_live.sql` **pasted verbatim** with exactly the four hunks below applied. Nothing else changes — not the signature, not the defaults, not `SECURITY DEFINER`, not `SET search_path TO 'public'`, not a single other line of the body. No `grant` statement appears in this file: `CREATE OR REPLACE` on an unchanged signature keeps the existing ACL, and re-issuing grants is how the 069/078 drop-recreate trap gets re-opened.

Header and guard:

```sql
-- 081: create_booking charges and stamps the admin-set service fee
-- (spec 2026-09-14 §4.1; plan 2026-09-14).
--
-- The rate is read HERE, in create_booking, not stamped by a before-insert
-- trigger. A trigger would read the setting in a DIFFERENT statement from the
-- one that computed the fee; under READ COMMITTED an admin change committing
-- between the two would stamp one rate on a fee computed at another. The rate
-- must be read once and used twice — which is exactly what v_fee_bps does.
--
-- The body below is pg_get_functiondef's output for the live function, pasted
-- verbatim, with four hunks applied. CREATE OR REPLACE on the unchanged
-- signature keeps the existing ACL (postgres, authenticated, service_role), so
-- this migration deliberately issues NO grant.

do $$
declare v_md5 text;
begin
  if (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_booking') <> 1 then
    raise exception '081 aborted: expected exactly one create_booking overload';
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_booking';

  if v_md5 <> 'ec309539300d75e69a905942b49fa484' then
    raise exception '081 aborted: create_booking is not the body this migration was written against (found md5 %). Re-capture with pg_get_functiondef, re-derive the four hunks against the new body, update this guard, and only then apply.', v_md5;
  end if;
end $$;
```

The four hunks, each of which matches exactly one place in the captured body:

**Hunk 1 — the declare block.** Replace the single line

```
  service_fee_rate    constant numeric := 0.05;
```

with

```
  -- 081: the admin-set platform rate (080). Read ONCE, so the fee charged and
  -- the rate stamped on the row are the same value by construction.
  v_fee_bps           constant integer := public.current_service_fee_bps();
  service_fee_rate    constant numeric := v_fee_bps / 10000.0;
```

`v_fee_bps` must be declared **before** `service_fee_rate`, which reads it. `v_fee_bps / 10000.0` is exact in `numeric` (the denominator is a power of ten), so at `500` the existing `round(v_rental * service_fee_rate)` produces byte-identical fees to today. `current_service_fee_bps()` raises when the settings row is missing, so the booking fails closed rather than being priced at an unknown rate.

**Hunk 2 — the stale comment.** Replace

```
  -- 038: change 2 of 4 — mirrors the host_qr guard above. A NULL fee means
```

with

```
  -- 038: change 2 of 4. A NULL fee means
```

(The `host_qr` guard it referred to was deleted by 078; TODO.md reserved this fix for "a future rewrite of that function, never a standalone one". This is that rewrite.)

**Hunk 3 — the insert column list.** Replace

```
    delivery_distance_km, delivery_latitude, delivery_longitude
```

with

```
    delivery_distance_km, delivery_latitude, delivery_longitude,
    service_fee_bps
```

**Hunk 4 — the values list.** Replace

```
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end
```

with

```
    case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end,
    v_fee_bps
```

Before applying, diff the migration's function text against `/tmp/create_booking_live.sql` and confirm the diff is **exactly** these four hunks and nothing else:

```bash
diff <(sed -n '/^CREATE OR REPLACE FUNCTION/,$p' supabase/migrations/081_create_booking_service_fee_bps.sql) /tmp/create_booking_live.sql
```

- [ ] **Step 3: Apply**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
supabase db query --linked "select count(*) as overloads, (select string_agg(grantee||':'||privilege_type, ',' order by grantee) from information_schema.routine_privileges rp where rp.routine_schema='public' and rp.routine_name='create_booking') as grants from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_booking';"
```

Expected: `081` applied; `overloads = 1`; `grants` still `authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE`.

- [ ] **Step 4: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add supabase/migrations/081_create_booking_service_fee_bps.sql
git commit -m "Charge and stamp the admin-set service fee in create_booking (migration 081)"
```

---

### Task B4: `scripts/verify/081-create-booking-service-fee-bps.mjs`

**Files:**
- Create: `scripts/verify/081-create-booking-service-fee-bps.mjs`

**Interfaces:**
- Consumes: `create_booking` (B3), `current_service_fee_bps` / `platform_settings` (B1).
- Reuses the `probe()` helper written in Task B2 Step 1, copied verbatim, including both harness proofs.

- [ ] **Step 1: Write the script**

Setup with the service role: one throwaway verified host (`@example.com`), one throwaway renter (`@example.com`), one active non-draft listing owned by the host with a known `daily_price` chosen so the fee differs visibly between rates (e.g. `daily_price = 1000`, 2 days → rental 2000; at 500 bps fee 100, at 750 bps fee 150). Real password sign-in for the renter via `signIn()`; every `create_booking` call goes through that session, never the service role (the service role's null `auth.uid()` takes a different branch).

Checks (spec §14, rows for 081):

1. **Harness proof** — both probe checks from Task B2 Step 1.
2. **Stamped at the live rate** — the renter calls `rpc/create_booking` for real (committed). Assert the returned row has `service_fee_bps === 500` and `service_fee === Math.floor((rental_fee * 500 + 5000) / 10000)`, and `total_amount === rental_fee + service_fee + delivery_fee` (protection and deposit are 0 since 035/070). Capture the booking id.
3. **A rate change applies to a new booking and not an old one** — inside one rolled-back probe, as service role: `perform public.set_service_fee_bps(750, 'probe', 'probe@example.com');` then `set_config('request.jwt.claims', …, true)` to the **renter's** claims, then `select * from public.create_booking(<listing>, <date+1>, <date+3>, false, null, 'qrph', null, null, null, null)` into a record, then read back the booking from check 2, then `raise exception 'VERIFY %', jsonb_build_object('new_bps', …, 'new_fee', …, 'new_rental', …, 'old_bps', …, 'old_fee', …)`. Assert: `new_bps = 750`; `new_fee = round(new_rental * 0.075)` computed independently in JS; `old_bps = 500` and `old_fee` unchanged — **the control that proves a rate change is not retroactive.**
   After the probe, service-role re-reads prove `platform_settings.service_fee_bps` is still `500`, the probe booking does not exist, and check 2's booking still reads `service_fee_bps = 500`.
4. **Same probe shape at the live rate** — repeat check 3's probe without the `set_service_fee_bps` call; the booking created inside it is stamped `500`. This is the control that attributes check 3's `750` to the rate change and not to the probe machinery.
5. **Fails closed with no settings row** — inside a rolled-back probe: `delete from public.platform_settings;` then a renter-claims `create_booking` call, wrapped in `begin … exception when others then raise exception 'VERIFY %', SQLERRM; end;` so the message is captured. Assert it contains "not configured". **Control:** the same probe without the delete succeeds and returns a booking. After the probe, a service-role read proves the settings row still exists with `service_fee_bps = 500`.
6. **One overload, ACL unchanged** — `supabase db query --linked` for `count(*) from pg_proc where proname='create_booking'` = 1 and `routine_privileges` = `authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE`.
7. **Body diff is exactly the four hunks** — re-run the `diff` from Task B3 Step 2 against the freshly captured live definition and assert the diff contains only the four hunks (count the changed hunks, and assert the removed lines are exactly the four originals). Also assert the new `md5` differs from `ec309539300d75e69a905942b49fa484` (proving 081 actually replaced the function) and record the new hash in the script output for the next rewrite.
8. **Delivery is still excluded from the fee base** — create one delivery booking on a listing with `delivery_fee = 100, delivery_fee_per_km = 0` and assert `service_fee === Math.floor((rental_fee * 500 + 5000) / 10000)` (unchanged by the ₱100) and `total_amount === rental_fee + service_fee + 100`.
9. **Rate-limit and lifecycle triggers still fire** — the 076 bookings cap (10/hour per renter) and 077's `guard_booking_insert` are `before insert` triggers on `bookings`; assert an overlapping-dates booking against a `confirmed` booking still raises, so 081 did not disturb the trigger path. (Set up the confirmed booking through the host's own session so `enforce_booking_transition` genuinely approves it.)
10. **Regression suite** — re-run `077-booking-lifecycle-and-insert-hardening`, `078-distance-based-delivery-fee`, `079-hardening-and-delivery-followups`, `079-rental-rounding-parity`, `076-rate-limiting` and require all to pass.
11. **Baseline and forbidden rows** — as in Task B2.

Cleanup: delete every probe booking and the notifications its triggers wrote, the probe listing and its `availability_blocks`, the probe `rate_limit_hits` rows, and both throwaway users; re-read each to prove it is gone.

- [ ] **Step 2: Run**

```bash
RESEND_API_KEY= node --experimental-strip-types scripts/verify/081-create-booking-service-fee-bps.mjs
for s in 076-rate-limiting 077-booking-lifecycle-and-insert-hardening 078-distance-based-delivery-fee 079-hardening-and-delivery-followups 079-rental-rounding-parity; do
  echo "== $s"; RESEND_API_KEY= node --experimental-strip-types scripts/verify/$s.mjs 2>&1 | tail -2
done
```

- [ ] **Step 3: Commit**

```bash
git add scripts/verify/081-create-booking-service-fee-bps.mjs
git commit -m "Verify create_booking reads and stamps the platform service fee"
```

---

### Task B5: Client mirror — `pricing.ts`, `service-fee.ts`, `useServiceFeeBps`, and every consumer

**Files:**
- Modify: `src/lib/pricing.ts`
- Create: `src/lib/service-fee.ts`
- Create: `src/hooks/useServiceFeeBps.ts`
- Modify: `src/types/index.ts`
- Modify: `src/app/api/payments/checkout/route.ts`
- Modify: `src/app/(main)/listings/[id]/page.tsx`
- Modify: `src/components/listings/BookingPanel.tsx`
- Modify: `src/app/(main)/book/page.tsx`
- Modify: `src/components/booking/BookingWizard.tsx`
- Modify: `src/components/booking/OrderSummary.tsx`
- Modify: `src/components/booking/Step3Payment.tsx`
- Modify: `src/components/booking/Step4Confirmation.tsx`

**Interfaces:**
- Consumes: `rpc/current_service_fee_bps() → number` (B1); `bookings.service_fee_bps` (B1/B3).
- Produces (TS):
  - `serviceFeeFor(rental: number, bps: number): number`
  - `formatFeeRate(bps: number): string`
  - `DEFAULT_SERVICE_FEE_BPS: 500`
  - `calcPricing(listing: PricedListing, days: number, serviceFeeBps: number, isDelivery?: boolean, deliveryFeeOverride?: number | null)`
  - `StoredBookingAmounts` gains `service_fee_bps: number | null`
  - `getServiceFeeBps(): Promise<number>` (server-only, `src/lib/service-fee.ts`)
  - `useServiceFeeBps(): { bps: number | null; loading: boolean }` (client, `src/hooks/useServiceFeeBps.ts`)
  - `Booking.service_fee_bps: number | null`
- Consumed by: Tasks B6 (parity + 409 verification), B7 (copy), B8 (admin UI), and Phase C's statement component (`payout_items.service_fee_bps`).

- [ ] **Step 1: `src/lib/pricing.ts`**

Delete `export const SERVICE_FEE_RATE = 0.05` outright — not deprecated, so `tsc` names every consumer. Add:

```ts
/**
 * Mock mode only. Live pages read the rate from the database
 * (getServiceFeeBps / useServiceFeeBps); this is what renders when no Supabase
 * is configured, and the fallback when a live read fails (see
 * src/lib/service-fee.ts for why falling back beats an error boundary).
 */
export const DEFAULT_SERVICE_FEE_BPS = 500

/**
 * Exactly Postgres `round(rental * (bps / 10000.0))` as create_booking (081)
 * evaluates it. bps/10000.0 is exact in numeric (a power-of-ten denominator),
 * and numeric round is half away from zero, so for non-negative integers
 * round(r*b/10000) = floor((r*b + 5000)/10000). Integer arithmetic throughout:
 * r*b tops out around 2e9 for any plausible rental at the 2000 bps cap, well
 * inside Number.MAX_SAFE_INTEGER, so no float rounding can creep in.
 *
 * Proven against Postgres over a grid including every tie by
 * scripts/verify/081-service-fee-client-parity.mjs — not asserted here.
 */
export function serviceFeeFor(rental: number, bps: number): number {
  return Math.floor((rental * bps + 5000) / 10000)
}

/** 500 -> "5%", 750 -> "7.5%", 1225 -> "12.25%", 0 -> "0%". */
export function formatFeeRate(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`
}
```

Change `calcPricing`'s signature so the rate is a **required third positional parameter** — placing it before the boolean means every stale call site fails to type-check rather than silently compiling against a default:

```ts
export function calcPricing(
  listing: PricedListing,
  days: number,
  serviceFeeBps: number,
  isDelivery = false,
  deliveryFeeOverride: number | null = null
) {
  const { rentalFee, tier } = calcRentalFee(listing, days)
  const serviceFee = serviceFeeFor(rentalFee, serviceFeeBps)
  const deliveryFee = isDelivery ? (deliveryFeeOverride ?? listing.delivery_fee ?? 0) : 0
  const total = rentalFee + serviceFee + deliveryFee
  return { rentalFee, tier, serviceFee, deliveryFee, total }
}
```

Update the doc comment above it: the service-fee rate is set by the admin (080) and read live; the figure here is a display, and the checkout route's 409 `total_changed` is the backstop that stops a mismatched charge.

Add `service_fee_bps: number | null` to `StoredBookingAmounts` and carry it through `storedBookingAmounts()`:

```ts
service_fee_bps: b.service_fee_bps == null ? null : Number(b.service_fee_bps),
```

- [ ] **Step 2: `src/lib/service-fee.ts`**

```ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { DEFAULT_SERVICE_FEE_BPS } from '@/lib/pricing'

/**
 * The platform service-fee rate in basis points, for server components.
 *
 * Falls back to DEFAULT_SERVICE_FEE_BPS and logs on any failure rather than
 * throwing the page into an error boundary: the number shown before payment is
 * a DISPLAY. create_booking computes the real fee server-side, and the checkout
 * route's 409 `total_changed` is what stops a mismatched charge — a listing
 * page that 500s because one RPC hiccuped would be a far worse outcome than a
 * stale percentage on a label.
 */
export async function getServiceFeeBps(): Promise<number> {
  if (!isSupabaseConfigured()) return DEFAULT_SERVICE_FEE_BPS
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('current_service_fee_bps')
    if (error || typeof data !== 'number') {
      console.error('[service-fee] rate read failed, using the default', error)
      return DEFAULT_SERVICE_FEE_BPS
    }
    return data
  } catch (err) {
    console.error('[service-fee] rate read threw, using the default', err)
    return DEFAULT_SERVICE_FEE_BPS
  }
}
```

- [ ] **Step 3: `src/hooks/useServiceFeeBps.ts`**

```ts
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { DEFAULT_SERVICE_FEE_BPS } from '@/lib/pricing'

/**
 * The platform service-fee rate for client components.
 *
 * `bps: null` after loading means the read FAILED. Host-facing copy must then
 * hide the percentage rather than print a guess — a host reading "5%" when the
 * rate is 7% is worse than a host reading a sentence with no number in it. (The
 * renter-facing side takes the opposite trade, in getServiceFeeBps: there the
 * number is a display and the 409 is the backstop.)
 */
export function useServiceFeeBps(): { bps: number | null; loading: boolean } {
  const [state, setState] = useState<{ bps: number | null; loading: boolean }>({
    bps: isSupabaseConfigured() ? null : DEFAULT_SERVICE_FEE_BPS,
    loading: isSupabaseConfigured(),
  })

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let cancelled = false
    createClient()
      .rpc('current_service_fee_bps')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || typeof data !== 'number') {
          console.error('[service-fee] rate read failed', error)
          setState({ bps: null, loading: false })
        } else {
          setState({ bps: data, loading: false })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
```

- [ ] **Step 4: `src/types/index.ts`**

In `Booking`, after `service_fee: number`, add:

```ts
  /** 081: the service-fee rate in basis points this booking was charged at. null for a pre-080 booking whose fee is ambiguous between 5% and 12%. */
  service_fee_bps: number | null
```

- [ ] **Step 5: Thread the rate through the renter-facing chain**

- `src/app/(main)/listings/[id]/page.tsx` — `import { getServiceFeeBps } from '@/lib/service-fee'`, `const serviceFeeBps = await getServiceFeeBps()`, and `<BookingPanel listing={listing} serviceFeeBps={serviceFeeBps} />`.
- `src/components/listings/BookingPanel.tsx` — add `serviceFeeBps: number` to its props; `calcPricing(listing, days, serviceFeeBps)`; any "service fee" label uses `formatFeeRate(serviceFeeBps)`.
- `src/app/(main)/book/page.tsx` — same `getServiceFeeBps()` call, `<BookingWizard … serviceFeeBps={serviceFeeBps} />`.
- `src/components/booking/BookingWizard.tsx` — add `serviceFeeBps: number` to `BookingWizardProps`; pass it into the `calcPricing(...)` call that builds `quotedTotal` (third positional argument, before `isDelivery`); pass it down to `<OrderSummary>` and `<Step3Payment>`.
- `src/components/booking/OrderSummary.tsx` — add `serviceFeeBps: number` to its props, use it in `calcPricing(listing, days, serviceFeeBps, isDelivery, perKm ? quotedFee : null)`, and change the hardcoded `<span>Service fee (5%)</span>` to `<span>Service fee ({formatFeeRate(serviceFeeBps)})</span>`. When a `StoredBookingAmounts` is in play (a booking already exists), the label reads the **stored** `service_fee_bps` when non-null and falls back to the live prop when null — the stored figure is what the renter will actually be charged.
- `src/components/booking/Step3Payment.tsx` — add `serviceFeeBps: number` to its props and pass it as the third argument to its `calcPricing(listing, days, serviceFeeBps, isDelivery)` call.
- `src/components/booking/Step4Confirmation.tsx` — the receipt's service-fee row reads **`booking.service_fee_bps`**, never a live rate: `Service fee{booking.service_fee_bps != null ? ` (${formatFeeRate(booking.service_fee_bps)})` : ''}`. A null renders as a bare "Service fee" with no percentage.

- [ ] **Step 6: Checkout route carries the stored rate back**

`src/app/api/payments/checkout/route.ts` needs no logic change — `create_booking` returns the full row and the reuse branch already does `select('*')`, so `service_fee_bps` is present on `booking`. `storedBookingAmounts(booking)` (Step 1) now copies it into `amounts`, which the 409 `total_changed` response already returns. Verify by reading: no other edit is required here. Add one line to the `expectedTotal` doc comment noting that a mid-checkout service-fee change surfaces through this same 409, exactly as a host rate change does.

- [ ] **Step 7: Build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

`tsc` is the coverage check here: deleting `SERVICE_FEE_RATE` and adding a required third parameter to `calcPricing` means a clean `tsc` proves every consumer was found. Two files outside this task's list also import `SERVICE_FEE_RATE` and are handled in Task B7 (`src/app/admin/reports/page.tsx`, `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`) — if the build must be green at the end of *this* task, make the minimal change in those two files here (swap to `getServiceFeeBps()` / `useServiceFeeBps()` respectively) and leave their **copy** rewrite to B7.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pricing.ts src/lib/service-fee.ts src/hooks/useServiceFeeBps.ts src/types/index.ts src/app/api/payments/checkout/route.ts "src/app/(main)/listings/[id]/page.tsx" src/components/listings/BookingPanel.tsx "src/app/(main)/book/page.tsx" src/components/booking/BookingWizard.tsx src/components/booking/OrderSummary.tsx src/components/booking/Step3Payment.tsx src/components/booking/Step4Confirmation.tsx src/app/admin/reports/page.tsx "src/app/(main)/dashboard/listings/[id]/edit/page.tsx"
git commit -m "Read the service fee rate from the database instead of a constant"
```

---

### Task B6: `scripts/verify/081-service-fee-client-parity.mjs` — JS↔Postgres parity and the checkout 409

**Files:**
- Create: `scripts/verify/081-service-fee-client-parity.mjs`

**Interfaces:**
- Consumes: `serviceFeeFor` / `formatFeeRate` from `src/lib/pricing.ts` (B5, imported as the **real module**, never reimplemented); `create_booking` (B3); `POST /api/payments/checkout` (B5 Step 6).

- [ ] **Step 1: Parity grid**

Run under `node --experimental-strip-types` importing `serviceFeeFor` from `../../src/lib/pricing.ts` directly (the module has no server-only imports, so this works without a bundler — the same technique the `toCsv` check already uses).

Build a grid of `(rental, bps)` pairs and compare `serviceFeeFor(rental, bps)` with Postgres `round(rental * (bps/10000.0))` evaluated in **one** `supabase db query --linked` call over a `values` list:

- `bps` ∈ `{0, 1, 100, 500, 750, 999, 1200, 1225, 1999, 2000}`
- `rental` ∈ `{0, 1, 2, 3, 7, 99, 100, 999, 1000, 2499, 2500, 15250, 123457, 1000000}`
- **plus every exact tie for each bps**: for each `bps`, the smallest `rental` values where `rental * bps % 10000 === 5000`, generated in JS (for `bps` values where a tie is reachable at all — e.g. `bps = 500` ties at `rental = 10, 30, 50, …`; `bps = 0` never ties). Include at least 20 such ties per bps that admits any. **The ties are the whole point**: half away from zero vs. half to even is exactly where a naive mirror diverges, and a divergence here produces a false "price changed" 409 for a real renter.

Assert every pair agrees. Report the grid size.

Also assert `formatFeeRate` on `{0: '0%', 100: '1%', 500: '5%', 750: '7.5%', 1000: '10%', 1225: '12.25%', 2000: '20%'}`.

- [ ] **Step 2: Checkout 409 on a stale total**

Build and serve a production build on port 3100 (3101 if taken). Setup via service role: a throwaway verified host, a throwaway renter with a real password, an active non-draft listing. Sign the renter in through the auth REST API and forge the SSR cookie (`sb-<ref>-auth-token` = `base64-` + base64url(session JSON)) — the documented e2e pattern.

- **Refusal:** `POST /api/payments/checkout` with a deliberately stale `expectedTotal` (the real total minus 1), `method: 'qrph'`, no `bookingId`. Assert: HTTP `409`; `code === 'total_changed'`; `amounts.service_fee_bps === 500`; `amounts.total_amount` equals the stored total; `amounts` carries `rental_fee`, `service_fee`, `delivery_fee`, `total_amount`; and — independently, via a service-role read of the created booking — `paymongo_ref is null`, proving **no PayMongo intent was created** before the refusal.
- **Control:** the same request with the matching `expectedTotal` and the same `bookingId` returns `200` with `status: 'qr'` and a `qrImage` (a real test-mode PayMongo intent). Delete that booking, its notifications and the intent's booking row afterwards.

Note `PAYMONGO_SECRET_KEY` in `.env.local` is a **test-mode** key by standing policy — this control creates a test intent, never a real charge. Confirm the key starts with `sk_test_` before running, and abort if it does not.

- [ ] **Step 3: Run and clean up**

```bash
npm run build && (PORT=3100 npm start &)
RESEND_API_KEY= node --experimental-strip-types scripts/verify/081-service-fee-client-parity.mjs
kill $(lsof -t -iTCP:3100)
```

Cleanup: every probe booking, notification, listing, `availability_blocks` row, `rate_limit_hits` row (`key like '%:<uid>'`) and throwaway user, each re-read to prove it is gone. Baselines and the forbidden host/booking checked as in Task B2.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/081-service-fee-client-parity.mjs
git commit -m "Verify the client fee mirror matches Postgres and the stale-total 409"
```

---

### Task B7: Copy corrected in the same phase (spec §4.4)

Three of these strings are **false today**, independently of the rate becoming variable: the host receives 100% of their rate and the fee is charged to the renter on top, but the wizard, the edit page and `/host-terms` all describe a deduction from the host.

**Files:**
- Modify: `src/components/host/Step3Pricing.tsx`
- Modify: `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`
- Modify: `src/app/(main)/host-terms/page.tsx`
- Modify: `src/app/(main)/terms/page.tsx`
- Modify: `src/app/admin/reports/page.tsx`

**Interfaces:**
- Consumes: `useServiceFeeBps()` in the two client files; `getServiceFeeBps()` + `formatFeeRate()` in the three server pages.

- [ ] **Step 1: Host wizard earnings preview — `Step3Pricing.tsx`**

Delete `hostReceives` (`Math.round(daily * 0.95)`) and the deduction row entirely. Replace the "Earnings Preview (per day)" block's three rows with two, computed from `useServiceFeeBps()`:

```
You receive            ₱{daily}
Renters pay            ₱{daily + serviceFeeFor(daily, bps)}
```

with the caption, verbatim:

> Renters pay ₱{daily + fee} per day — your rate plus Rentivo's {rate} service fee, charged to the renter. Nothing is deducted from your earnings.

When `bps` is `null` (a failed read) or `loading`, render only "You receive ₱{daily}" and the sentence "Renters also pay Rentivo's service fee on top of your rate." — no number, no guess. The `serviceFee` and `renterPays` locals become `serviceFeeFor(daily, bps)` and `daily + serviceFeeFor(daily, bps)`. The label reading "Rentivo service fee (5%)" with a red minus sign is deleted, not reworded: it asserts a deduction that does not happen.

- [ ] **Step 2: Listing edit page**

Replace line ~432's "You earn ₱{daily × 0.95} per day after the {5}% Rentivo service fee." with the same two-line shape and sentence as Step 1, driven by `useServiceFeeBps()`. Remove the `SERVICE_FEE_RATE` import.

- [ ] **Step 3: `/host-terms`**

Replace the single bullet

> Rentivo charges a 5% service fee on the rental fee of every booking, deducted from the payment when it is processed. Delivery fees you set are paid to you in full.

with, verbatim:

> Rentivo charges renters a service fee of {rate} of the rental fee, added on top of your price at checkout. It is not deducted from your earnings. Delivery fees are paid to you in full.

`{rate}` is `formatFeeRate(await getServiceFeeBps())`. Add `export const dynamic = 'force-dynamic'` to the page so a rate change is never served from a static build.

- [ ] **Step 4: `/terms` §6**

Both "5%" sentences read the live rate:

- "Rentivo charges a 5% service fee on the rental amount only." → "Rentivo charges a {rate} service fee on the rental amount only. The rate in effect when a booking is made is the rate charged for that booking; a later change does not affect it."
- "The 5% service fee is collected as part of the renter's payment at checkout…" → "The {rate} service fee is collected as part of the renter's payment at checkout…"

Add `export const dynamic = 'force-dynamic'`.

- [ ] **Step 5: `/admin/reports`**

Replace the `SERVICE_FEE_RATE * 100` caption with, verbatim:

> Commission is the service fee stamped on each booking (currently {rate}).

`{rate}` from `getServiceFeeBps()`. Remove the `SERVICE_FEE_RATE` import. The page is already `force-dynamic`.

- [ ] **Step 6: Prove no stale percentage survives**

```bash
grep -rn "SERVICE_FEE_RATE\|0\.95\|5% service fee\|service fee (5%)" src --include="*.ts" --include="*.tsx" -i
```

Expected: no hits outside comments that are explicitly historical.

- [ ] **Step 7: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add src/components/host/Step3Pricing.tsx "src/app/(main)/dashboard/listings/[id]/edit/page.tsx" "src/app/(main)/host-terms/page.tsx" "src/app/(main)/terms/page.tsx" src/app/admin/reports/page.tsx
git commit -m "Say the service fee is charged to renters, at the live rate"
```

---

### Task B8: Admin UI — `/admin/settings`, its route, and the overview card

**Files:**
- Create: `src/app/admin/settings/page.tsx`
- Create: `src/components/admin/ServiceFeeForm.tsx`
- Create: `src/app/api/admin/settings/service-fee/route.ts`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `set_service_fee_bps(p_bps, p_reason, p_admin_email)` (B1); `platform_settings` read with the service-role client; `admin_actions` rows with `action = 'service_fee_rate_change'`; `formatFeeRate`, `serviceFeeFor` (B5).
- Produces: `POST /api/admin/settings/service-fee` with body `{ bps: number; reason: string }` → `200 { previous_bps: number, service_fee_bps: number }` or `400 { error: string }` or `404` (non-admin).

- [ ] **Step 1: The API route**

```ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate

  let body: { bps?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Validate before the RPC so a typo never reaches a money setting; the RPC
  // re-validates, because it is the only thing a direct service-role caller
  // would hit.
  const bps = body.bps
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 2000) {
    return NextResponse.json(
      { error: 'The service fee must be a whole number of basis points between 0 and 2000 (0% and 20%).' },
      { status: 400 }
    )
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('set_service_fee_bps', {
    p_bps: bps,
    p_reason: reason,
    p_admin_email: gate.email,
  })
  if (error) {
    return NextResponse.json({ error: error.message.replace(/^.*?: /, '') }, { status: 400 })
  }
  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json(row)
}
```

The audit row is written inside the RPC (B1) — this route must **not** insert one.

- [ ] **Step 2: `/admin/settings` page (server)**

`export const dynamic = 'force-dynamic'`. Reads with `createAdminClient()`:

- `platform_settings` (`service_fee_bps`, `updated_at`) — the current rate and when it last changed.
- `admin_actions` where `action = 'service_fee_rate_change'`, `order created_at desc`, `limit 50` — rendered as a history table: date, admin email, `detail.previous_bps` → `detail.service_fee_bps` (both through `formatFeeRate`), and `detail.reason`. Reason text is admin-authored; render it as text, never as HTML.

Renders `<ServiceFeeForm currentBps={…} />` beneath.

- [ ] **Step 3: `ServiceFeeForm.tsx` (client)**

- One percentage input accepting up to two decimals (`step="0.01"`, `min="0"`, `max="20"`), converted to bps as `Math.round(Number(pct) * 100)` — reject a value that does not round-trip (`Math.round(Number(pct) * 100) / 100 !== Number(pct)`) with "Enter a percentage with at most two decimals."
- A required reason textarea (trimmed, non-empty, `maxLength={500}`).
- A live preview computed with `serviceFeeFor`, verbatim shape: *"On a ₱1,000 rental the renter pays ₱{1000 + serviceFeeFor(1000, currentBps)} now, ₱{1000 + serviceFeeFor(1000, nextBps)} after."*
- Submit guarded by `confirm()` naming **both** rates: *"Change Rentivo's service fee from {formatFeeRate(currentBps)} to {formatFeeRate(nextBps)}? Every booking made from now on is charged at the new rate."*
- On success, `router.refresh()`. On failure, render the route's `error` string.
- Disabled while submitting and when the entered rate equals the current one (the RPC refuses a no-op; the form should not offer it).

- [ ] **Step 4: Nav and overview card**

- `src/app/admin/layout.tsx` — add `<Link href="/admin/settings" className="hover:underline">Settings</Link>` after Reports.
- `src/app/admin/page.tsx` — add a card. The existing cards render a count; this one renders the rate, so give it its own shape rather than forcing it through `pendingCount`: read `platform_settings.service_fee_bps` with the admin client and render `{ label: 'Service fee', value: formatFeeRate(bps), href: '/admin/settings' }`, with the card component taking `value: string` instead of `count: number` (convert the existing cards to `String(count)`).

- [ ] **Step 5: Access-control check**

With a real production build on port 3100 and forged session cookies, exercise the matrix and record each result:

| Caller | `/admin/settings` | `POST /api/admin/settings/service-fee` |
|---|---|---|
| signed out | `307` → `/login?next=%2Fadmin%2Fsettings` | `404` |
| demo renter (`renter@demo.rentivo.ph`) | `404` | `404` |
| demo host (on the local `ADMIN_EMAILS` allowlist) | `200` | `400` with the RPC's own message on `{ bps: 500, reason: 'x' }` (the current rate — a no-op the RPC refuses), proving the gate passed and the real RPC ran |

⚠️ `ADMIN_EMAILS` must exist in `.env.local` and include `demo@demo.rentivo.ph`. If every admin case returns `404` identically to the non-admin cases, the variable is missing — with no allowlist, nobody is an admin. Check that before debugging the gate.

- [ ] **Step 6: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add src/app/admin/settings/page.tsx src/components/admin/ServiceFeeForm.tsx src/app/api/admin/settings/service-fee/route.ts src/app/admin/layout.tsx src/app/admin/page.tsx
git commit -m "Let an admin set the service fee from the admin panel"
```

---

### Task B9: Browser verification on a production build, and the docs

> ⚠️ **This task commits one real rate change on production data. Give the owner a heads-up before running it and get an acknowledgement.** The change is 5.00% → 5.10% → 5.00%, held for under two minutes, on the live database. A booking created by a real renter inside that window would be charged 5.10% — permanently, since the rate is stamped on the row. The window is bracketed by a query for any non-probe booking created in it (Step 3); if one appears, report it to the owner with the booking ref and the ₱ difference rather than quietly reverting.

**Files:**
- Modify: `AGENTS.md`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: everything Tasks B1–B8 produce — `/admin/settings` and its route, `set_service_fee_bps`, `current_service_fee_bps`, `create_booking`'s stamp, `calcPricing`'s rate parameter, `formatFeeRate`, and the checkout 409.
- Produces: the AGENTS.md Status entry and the TODO.md done entry that Phase C's Task C1 relies on for "Phase B is deployed" (it states which migrations are applied remotely and what the live rate is).

- [ ] **Step 1: Serve a production build**

```bash
npm run build
PORT=3100 npm start
```

Confirm the port is actually free first (`lsof -t -iTCP:3100`) and that the process serving it is the one you just started — a silent `EADDRINUSE` leaves the old bundle serving and every "verification" below then measures pre-fix code.

- [ ] **Step 2: Renter-side reading of the live rate**

Signed in as the demo renter (forged SSR cookie), with the rate at 5.00%:

- A listing detail page's booking panel shows "Service fee (5%)" and a total matching `serviceFeeFor(rentalFee, 500)`.
- `/book?listing=<id>&from=…&to=…` Order Summary shows the same label and total.
- The payment step's total equals the summary's.

- [ ] **Step 3: The bracketed real rate change**

1. Record `select max(created_at) from public.bookings;` and the wall-clock time.
2. As the admin in a browser, `/admin/settings` → change to **5.10%** with reason `"Verification of the admin rate control (plan 2026-09-14 Task B9)"`. Observe the confirm dialog naming both rates, and the history table gaining a row.
3. In the renter tab, reload the listing page: the label reads "Service fee (5.1%)" and the total is `serviceFeeFor(rentalFee, 510)` higher.
4. **Observe the 409 path on a probe listing**: on a throwaway host's listing, have the renter reach the payment step at one rate, change the rate in the admin tab, then press Pay. The wizard must show the new total with the "price changed since you reviewed it" message and no charge. (Do this on a throwaway listing, not a real host's.)
5. Change back to **5.00%** with reason `"Restoring after verification (plan 2026-09-14 Task B9)"`.
6. Bracket: `select booking_ref, renter_id, created_at, service_fee_bps from public.bookings where created_at > '<recorded time>';` — assert every row belongs to a probe account. Report any that does not.
7. Confirm `platform_settings.service_fee_bps = 500` and that `admin_actions` gained exactly the expected `service_fee_rate_change` rows (they are a deliberate audit trail and are **kept**, not deleted).

- [ ] **Step 4: Host-side copy**

Signed in as the demo host: the wizard's pricing step and a listing's edit page both show "You receive ₱{daily}" with no deduction row, and the "Nothing is deducted from your earnings" sentence naming 5%. `/host-terms` and `/terms` both render the live rate.

- [ ] **Step 5: Clean up and restore**

Delete every probe booking and its notifications, the probe listing and its `availability_blocks`, probe `rate_limit_hits` rows, and the throwaway users; re-read each to prove it is gone. Re-check baselines and the forbidden host/booking.

- [ ] **Step 6: Docs**

`AGENTS.md`:
- Repository map: migrations `080 platform service fee + per-booking rate`, `081 create_booking reads and stamps the rate`; `src/lib/service-fee.ts`; `src/hooks/useServiceFeeBps.ts`; `src/app/admin/settings`.
- Booking lifecycle: the service fee is now an admin-set platform rate in basis points (`platform_settings`, read by `current_service_fee_bps()`); `create_booking` reads it **once** and uses it twice (compute + stamp `bookings.service_fee_bps`) — record why a trigger was rejected; the rate is fixed at booking creation, not at payment; a mid-checkout change surfaces through the existing 409 `total_changed`; refunds and payouts are unaffected (the host is paid `rental_fee + delivery_fee` regardless).
- Security model: `platform_settings` has RLS with no policies and no client grants; `set_service_fee_bps` is `service_role` only and writes its own `admin_actions` row in the same transaction; `admin_actions.target_user_id` is now nullable; `bookings.service_fee_bps` is readable by the parties and not client-writable (040's UPDATE list is unchanged).
- A Status entry recording what was verified live (including the bracketed real rate change and its result) and what was not.
- Correct the standing claim that the host "receives 0.95×" — it was never true; the renter pays the fee on top.

`TODO.md`: a done entry for the admin-controlled service fee, noting the per-booking stamp, the backfill counts, and that Phase C (payout statements) is next and depends on `bookings.service_fee_bps`.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md TODO.md
git commit -m "Record the admin-controlled service fee"
```

---

### Task B10: Whole-branch review of Phase B

**Files:**
- Verify (no edits unless a finding requires one): the whole Phase B diff — `supabase/migrations/080_platform_service_fee.sql`, `supabase/migrations/081_create_booking_service_fee_bps.sql`, `src/lib/pricing.ts`, `src/lib/service-fee.ts`, `src/hooks/useServiceFeeBps.ts`, `src/types/index.ts`, `src/app/api/payments/checkout/route.ts`, `src/app/api/admin/settings/service-fee/route.ts`, `src/app/admin/settings/page.tsx`, `src/components/admin/ServiceFeeForm.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/reports/page.tsx`, `src/app/(main)/listings/[id]/page.tsx`, `src/app/(main)/book/page.tsx`, `src/app/(main)/terms/page.tsx`, `src/app/(main)/host-terms/page.tsx`, `src/app/(main)/dashboard/listings/[id]/edit/page.tsx`, `src/components/listings/BookingPanel.tsx`, `src/components/booking/{BookingWizard,OrderSummary,Step3Payment,Step4Confirmation}.tsx`, `src/components/host/Step3Pricing.tsx`, and the four `scripts/verify/08*` scripts.
- Modify: only files a finding requires.

**Interfaces:**
- Consumes: every interface Tasks B1–B9 produce.
- Produces: a deployed Phase B on `main` — the precondition Task C1 checks before starting.

- [ ] **Step 1: Review**

Use `superpowers:requesting-code-review` against the full Phase B diff (`git diff <base>..HEAD`). The review must specifically look for the things a per-task review structurally cannot see — relationships between tasks:

- Every `calcPricing` call site passes a **real** rate, not `DEFAULT_SERVICE_FEE_BPS` smuggled in as a convenience.
- No page that displays a rate is statically rendered (`npm run build`'s route table: `/terms`, `/host-terms`, `/admin/reports`, `/admin/settings`, `/admin` are all `ƒ (Dynamic)`; `/listings/[id]` and `/book` already are).
- The receipt (`Step4Confirmation`) reads the **stored** rate and every pre-payment surface reads the **live** one, with no crossover.
- The 409 `amounts` payload and `StoredBookingAmounts` agree field for field.
- No new function anywhere in the diff is missing its `revoke all … from public`.
- `serviceFeeFor`'s integer arithmetic cannot overflow at the largest `daily_price` the listings table actually permits.
- Nothing reintroduces a hardcoded percentage in copy.

- [ ] **Step 2: Fix and re-verify**

Address every finding. Re-run all four Phase B verification scripts plus the 076–079 regression set, and `npx tsc --noEmit && npm run lint && npm run build`.

- [ ] **Step 3: Ship Phase B**

```bash
git push origin main
```

The Vercel Git integration auto-deploys on push to `main`; a manual `vercel deploy --prod --yes` is redundant. After the deploy, read-only production checks: `/`, `/search` and a listing page `200` and show the live rate; `/admin/settings` signed out `307`; a bare `GET` on `/api/admin/settings/service-fee` `404`; `/terms` and `/host-terms` render the live rate. **Do not attempt a payment** — that moves real money on live keys and proves nothing this does not.

---

# END OF PHASE B

**Phase B is deployed before Phase C begins.** Confirm `rentivo.live` is serving the new build and that migrations 080 and 081 are listed as applied remotely before starting Task C1.

---

# PHASE C — admin-issued payout statements

Migrations 082 and 083.

---

### Task C1: Migration 082 — statement columns, snapshots, counters, eligibility, lifecycle RPCs

**Files:**
- Create: `supabase/migrations/082_payout_statements.sql`

**Interfaces:**
- Produces columns on `public.payout_requests`: `statement_number text unique`, `account_method public.payout_method`, `account_name text`, `account_number text`, `transferred_on date`, `reversed_at timestamptz`, `reversal_reason text`, `statement_emailed_at timestamptz`.
- Produces columns on `public.payout_items`: `booking_ref text not null`, `listing_title text not null`, `pickup_date date not null`, `return_date date not null`, `rental_fee integer not null`, `delivery_fee integer not null`, `service_fee integer not null`, `service_fee_bps integer`.
- Produces table `public.payout_statement_counters (year integer pk, last_number integer)`.
- Produces functions:
  - `public.payout_eligible_bookings(p_host_id uuid default null) returns table (booking_id uuid, host_id uuid, payable integer)` — internal, **no client grant**.
  - `public.payouts_owed(p_host_id uuid default null) returns table (host_id uuid, bookings integer, amount integer)` — `service_role` only.
  - `public.my_payout_balance() returns table (bookings integer, amount integer)` — `authenticated`, `service_role`.
  - `public.create_payout_statement(p_host_id uuid, p_expected_amount integer, p_admin_email text) returns public.payout_requests` — `service_role` only.
  - `public.issue_payout_statement(p_request_id uuid, p_reference text, p_transferred_on date, p_admin_email text) returns public.payout_requests` — `service_role` only.
  - `public.cancel_payout_statement(p_request_id uuid, p_reason text, p_admin_email text) returns public.payout_requests` — `service_role` only.
  - `public.reverse_payout_statement(p_request_id uuid, p_reason text, p_admin_email text) returns public.payout_requests` — `service_role` only.
- Redefines `request_payout()`, `mark_payout_paid(uuid, text)`, `mark_payout_failed(uuid, text)` to raise. All three return `payout_requests` (confirmed live); `CREATE OR REPLACE` keeps their grants (`request_payout`: `authenticated, service_role, postgres`; the other two: `service_role, postgres`).
- Revokes table-level `INSERT, UPDATE, DELETE` on `payout_accounts`, `payout_requests`, `payout_items` from `anon`, `authenticated`.
- Consumed by: C2 (verification), C3 (host UI), C4 (admin UI), C5 (email), C6 (account deletion), C7 (083 drops the three stubs).

- [ ] **Step 1: Confirm no client code writes the three payout tables directly**

```bash
grep -rn "from('payout_accounts')\|from('payout_requests')\|from('payout_items')" src --include="*.ts" --include="*.tsx"
```

Every hit must be either a `.select(...)` or a `createAdminClient()` (service-role) call. `src/lib/account-deletion.ts` writes `payout_accounts` and `payout_requests.notes` with the service role — unaffected by a revoke from `anon`/`authenticated`. If any hit is a user-session write, **stop** and report it: the revoke below would break it silently at runtime, not at build time.

- [ ] **Step 2: Confirm the legacy row state the backfill assumes**

```bash
supabase db query --linked "select status, count(*) from public.payout_requests group by 1; select count(*) as items from public.payout_items;"
```

At authoring: `paid = 1`, `pending = 0`, `failed = 0`, `items = 1`. The migration's guard aborts on anything else.

- [ ] **Step 3: Write `supabase/migrations/082_payout_statements.sql`**

```sql
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

create or replace function public.mark_payout_paid(p_request_id uuid, p_reference text)
returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Payouts now use statements — reload the page.';
end;
$$;

create or replace function public.mark_payout_failed(p_request_id uuid, p_notes text)
returns public.payout_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Payouts now use statements — reload the page.';
end;
$$;
```

- [ ] **Step 4: Apply**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
supabase db query --linked "select id, status, statement_number, amount, reference, transferred_on, account_method, account_name, account_number from public.payout_requests; select * from public.payout_statement_counters;"
```

Expected: `082` applied; the one legacy row is `PS-2026-000001` with its account snapshot filled and `transferred_on` set; the counter holds `(2026, 1)`.

- [ ] **Step 5: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add supabase/migrations/082_payout_statements.sql
git commit -m "Turn payout requests into admin-issued statements (migration 082)"
```

---

### Task C2: `scripts/verify/082-payout-statements.mjs`

**Files:**
- Create: `scripts/verify/082-payout-statements.mjs`

**Interfaces:**
- Consumes everything Task C1 produces. Reuses the `probe()` helper and both harness proofs from Task B2 Step 1, copied verbatim.

**Why so much of this is a rolled-back probe:** a committed test issue would permanently occupy a gapless statement number with a fake payout. The draft/cancel path *is* committed (a cancelled draft consumes no number and is deleted afterwards); issuing and reversing are proven only inside probes.

- [ ] **Step 1: Write the script**

Setup, service role: throwaway host A (`@example.com`, verified payout account, eligible completed+paid bookings created by driving a throwaway renter's real booking through `confirmed → active → completed` **via the host's own session**, so `enforce_booking_transition` genuinely approves each hop — the service role's null `auth.uid()` bypasses the transition rules and would prove nothing); throwaway host B (no payout account); throwaway host C (verified account, then suspended); a throwaway renter; a signed-in throwaway stranger.

Checks (spec §14, rows for 082), each refusal paired with its control:

1. **Harness proof** — both probe checks from Task B2 Step 1.
2. **Table writes are privilege-denied** — host A's session: `POST /rest/v1/payout_requests`, `PATCH /rest/v1/payout_requests?id=eq.<own>`, `DELETE` the same, and the equivalents on `payout_items` and `payout_accounts` → each `permission denied for table …` (assert the message, not merely a non-2xx; a silent zero-row result is a different failure). **Control:** host A's `rpc/set_payout_account` still succeeds (restore the original values afterwards), and host A's `GET /rest/v1/payout_requests?host_id=eq.<own>` still returns their rows.
3. **Anon holds nothing** — anon `POST`/`PATCH`/`DELETE` on all three tables → `401`, and anon `GET` on `payout_requests` → empty or 401. **Control:** anon `rpc/current_service_fee_bps` → 200 (proving the anon key itself works).
4. **Lifecycle RPCs are service-role only** — host A's session calling `create_payout_statement`, `issue_payout_statement`, `cancel_payout_statement`, `reverse_payout_statement`, `payouts_owed`, `payout_eligible_bookings` → each `permission denied for function …`. Anon → `401`. **Control:** host A's `rpc/my_payout_balance` → `200` with `[{bookings, amount}]` equal to a service-role `payouts_owed(hostA)` for the same host; the throwaway renter's `my_payout_balance` → `[{bookings: 0, amount: 0}]`; anon `my_payout_balance` → refused (`401`, and if it somehow returns 200 the platform-wide leak guard has failed — treat as a hard stop).
5. **Eligibility excludes the right bookings** — build, for host A, one `completed`+`paid` `qrph` booking (eligible) and, via service-role inserts that mirror `create_booking`'s stored shape, one `host_qr` and one `test_skip` `completed`+`paid` booking. Assert `payouts_owed(hostA)` counts only the `qrph` one. **Control:** the `qrph` one is present and its `payable` equals `rental_fee + delivery_fee`.
6. **Draft refusals** — as service role: suspended host C → "Payouts are on hold"; host B (no account) → "no verified payout account"; host A with a deliberately wrong `p_expected_amount` → "The amount owed changed from … to …"; a second draft for host A while one is open → "already has a draft"; a host with nothing owed → "nothing owed right now"; a blank admin email → raises; a zero/negative expected amount → raises. **Control:** host A at the correct amount → a real, **committed** draft, whose `amount` equals the sum of its items, whose items carry the snapshot columns (`booking_ref`, `listing_title`, `pickup_date`, `return_date`, `rental_fee`, `delivery_fee`, `service_fee`, `service_fee_bps`), and whose `account_method`/`account_name`/`account_number` equal host A's account at that moment. Also assert `admin_actions` gained one `payout_statement_draft` row.
7. **A draft claims its bookings** — with the draft open, `payouts_owed(hostA)` returns no row for host A (or an amount of 0). **Control:** after cancelling the draft in check 9, it returns the original amount again.
8. **Issue refusals and the numbering, inside probes** — for each, a probe that raises: blank reference; a >100-char reference; a transfer date in the future (Manila); a transfer date before the draft's `requested_at` Manila date; issuing a cancelled draft; issuing an already-`paid` statement with a *different* reference. **Controls, all inside probes:**
   - Issuing the real draft with a valid reference and today's Manila date → `statement_number` is `PS-<current Manila year>-<lpad(last+1)>`, `status = 'paid'`, `transferred_on` set, `processed_at` set.
   - Two issues inside **one** probe (the real draft, plus a second draft prepared inside the same probe for host C-with-account) → **consecutive** numbers.
   - Re-issuing with the **same** reference inside the probe → returns the row unchanged (idempotent), and does **not** consume a second number.
   - After every probe, a service-role read proves `payout_statement_counters` is still `(2026, 1)` and no new `statement_number` exists — **the proof that the gapless series was not burned by verification.**
9. **Cancel** — commit a cancel of the real draft with a reason: `status = 'failed'`, `statement_number is null`, `notes` = the reason, `processed_at` set; `admin_actions` gained a `payout_statement_cancel` row. **Refusals:** cancelling with a blank reason → raises; cancelling an *issued* statement (inside a probe that issues first) → "reverse it instead". **Control (idempotency):** cancelling the already-cancelled draft returns it unchanged.
10. **Reverse, inside a probe** — issue the draft, then reverse it with a reason: `status = 'failed'`, `statement_number` **kept**, `reversed_at` set, `reversal_reason` set; `payouts_owed(hostA)` inside the same probe returns the amount again (the bookings are released); `admin_actions` gained a `payout_statement_reverse` row; a second reverse returns unchanged. **Refusals:** reversing a draft → "cancel it instead"; a blank reason → raises.
11. **Concurrent issue** — two `supabase db query --linked` processes started together, each a probe that prepares and issues a draft for a different throwaway host and then sleeps briefly before raising. Assert the two statement numbers are **consecutive and distinct**, and that after both roll back the counter is unchanged. (If the harness cannot reliably overlap them, assert instead that the counter upsert takes a row lock by running the two probes serially and showing each gets `last+1` from the same starting value — and say plainly in the script output that true concurrency was not demonstrated.)
12. **Old functions raise** — service role: `rpc/request_payout`, `rpc/mark_payout_paid`, `rpc/mark_payout_failed` → each raises "Payouts now use statements — reload the page." Host A's session calling `request_payout` → the same message (its `authenticated` grant survives the replace, which is the point: an old tab gets a sentence, not a silent success).
13. **Constraints hold** — service-role attempts that must fail: `UPDATE payout_requests SET status='paid'` on a draft with no statement number → `payout_requests_paid_complete`; setting `statement_number` on a `pending` row → `payout_requests_pending_unnumbered`; setting `reversed_at` with `status='paid'` → `payout_requests_reversal_shape`; inserting a `payout_items` row whose `amount <> rental_fee + delivery_fee` → `payout_items_amount_matches`; a `statement_number` not matching `^PS-[0-9]{4}-[0-9]{6}$` → the check. Each inside a probe. **Control:** the legacy row `PS-2026-000001` satisfies all four constraints (it survived the `alter table … add constraint`).
14. **Legacy row** — service-role read: `statement_number = 'PS-2026-000001'`; `account_method`/`account_name`/`account_number` non-null and equal to the linked `payout_accounts` row; `transferred_on = (processed_at at time zone 'Asia/Manila')::date`; `amount` equals the sum of its `payout_items.amount`; its item carries all snapshot columns.
15. **Baseline and forbidden rows** — as in Task B2, plus `payout_statement_counters` unchanged.

Cleanup: the cancelled draft and its items deleted, every probe booking and its notifications, probe listings and `availability_blocks`, probe `rate_limit_hits`, probe `payout_accounts`, the `admin_actions` rows this run wrote (they name probe hosts, so they are probe rows, unlike Phase B's deliberate audit trail), and all throwaway users — each re-read to prove it is gone.

- [ ] **Step 2: Run**

```bash
RESEND_API_KEY= node --experimental-strip-types scripts/verify/082-payout-statements.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/verify/082-payout-statements.mjs
git commit -m "Verify payout statement lifecycle, numbering and grants"
```

---

### Task C3: The statement document, and the host's payouts pages

**Files:**
- Create: `src/components/payouts/PayoutStatement.tsx`
- Create: `src/hooks/usePayoutBalance.ts`
- Create: `src/app/(main)/dashboard/payouts/[id]/page.tsx`
- Modify: `src/hooks/usePayoutRequests.ts`
- Modify: `src/app/(main)/dashboard/payouts/page.tsx`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: `rpc/my_payout_balance() → [{ bookings: number; amount: number }]` (C1); `payout_requests` + `payout_items` reads under the existing SELECT-own RLS.
- Produces (TS):
  - `PayoutRequest` gains `statement_number: string | null`, `account_method: PayoutAccount['method'] | null`, `account_name: string | null`, `account_number: string | null`, `transferred_on: string | null`, `reversed_at: string | null`, `reversal_reason: string | null`, `statement_emailed_at: string | null`.
  - `PayoutItem` gains `booking_ref: string`, `listing_title: string`, `pickup_date: string`, `return_date: string`, `rental_fee: number`, `delivery_fee: number`, `service_fee: number`, `service_fee_bps: number | null`.
  - `usePayoutBalance(): { bookings: number; amount: number; loading: boolean; error: string | null }`
  - `<PayoutStatement request={PayoutRequest} items={PayoutItem[]} />` — presentational, no data fetching, used by **both** this page and `/admin/payouts/[id]` (Task C4).
  - `usePayoutRequests()` **loses** `requestPayout`, `availableBalance` and `pendingPayout`; keeps `requests`, `loading`, `reload`, `hasPendingRequest`.
- Consumed by: Task C4 (the same `PayoutStatement` component), Task C5 (the email mirrors this document's figures).

- [ ] **Step 1: `PayoutStatement.tsx`**

Presentational only. Wrapped in `<div id="receipt-print-area">` so the existing print CSS in `src/app/globals.css` applies unchanged — **one print area per page**, so a page rendering this must not also render another `#receipt-print-area`.

Sections, in spec §8's order:

- **Header** — "Payout Statement", the `statement_number`, status (`Paid`, or `REVERSED` with `reversed_at`'s date and `reversal_reason`), issue date (`processed_at`), transfer date (`transferred_on`), transfer reference.
- **From** — `BUSINESS.name`, `DTI No. {BUSINESS.dtiNumber}`, `BUSINESS_ADDRESS`, `BUSINESS.email` (from `src/lib/business.ts`).
- **Paid to** — `account_name`, `account_method`, `account_number` masked to the last four (`•••• 4567`).
- **Period** — earliest `pickup_date` to latest `return_date` across the items.
- **Bookings table** — `booking_ref`, `listing_title`, `pickup_date`–`return_date`, `rental_fee`, `delivery_fee`, `service_fee` (with `formatFeeRate(service_fee_bps)` appended when non-null, nothing when null), and "Your earnings" = `rental_fee + delivery_fee`.
- **Summary** — exactly these four lines, in this order:

| Line | Value |
|---|---|
| Gross booking value | `Σ (rental_fee + delivery_fee + service_fee)` |
| Less: Rentivo service fee | `Σ service_fee` |
| &nbsp;&nbsp;of which delivery fees (paid to you in full) | `Σ delivery_fee` |
| **Net paid to you** | `Σ (rental_fee + delivery_fee)` — assert in the component that this equals `request.amount` and render a visible discrepancy warning if it does not |

  followed, verbatim:

  > The service fee was charged to renters on top of your rental price at checkout. It was not deducted from your rental rate.

  These definitions exist so "gross − fee = net" holds **exactly** under the renter-pays model. Pre-035 protection fees and pre-070 deposits are excluded from gross (neither reached the host).

- **Footer**, verbatim:

  > This is a payout statement from Appnado IT Solutions. It is not an official receipt or invoice.

- [ ] **Step 2: `usePayoutBalance.ts`**

```ts
'use client'
```
Calls `rpc('my_payout_balance')`, returns the single row's `{ bookings, amount }`, `{ bookings: 0, amount: 0 }` when Supabase is not configured, and surfaces an `error` string on failure rather than silently rendering `₱0` (a host seeing ₱0 when the read failed would think they are owed nothing).

- [ ] **Step 3: Slim `usePayoutRequests`**

Delete `requestPayout`, `availableBalance`, `pendingPayout` and the `useHostBookings()` import that fed them (the third, wrong eligibility mirror the spec names — it summed `rental_fee` only, omitting delivery fees, the `host_qr`/`test_skip` exclusions and 077's return-date rule). Keep `requests` (now with the statement columns on the select — `'*, items:payout_items(*)'` already returns them), `loading`, `hasPendingRequest`, `reload`.

- [ ] **Step 4: `/dashboard/payouts`**

- The balance card reads `usePayoutBalance()`. Heading "Owed to you". **No button.** Caption, verbatim:

  > Rentivo pays out completed rentals to your verified account — you don't need to request it.

- The payout account section is unchanged.
- History renders, newest first:
  - `status === 'pending'` → "Being prepared — ₱{amount}", no link.
  - `status === 'paid'` → statement number, amount, `transferred_on`, reference; links to `/dashboard/payouts/{id}`.
  - `status === 'failed' && reversed_at` → the statement number with a "Reversed" pill and `reversal_reason`; links to `/dashboard/payouts/{id}`.
  - `status === 'failed' && !reversed_at` (a cancelled draft) → **hidden**. The host never saw it and never received anything.
- Mock mode keeps a `MOCK_ACCOUNT` and a fixed balance; the mock request list gains the new fields so the statement page renders in mock mode too.

- [ ] **Step 5: `/dashboard/payouts/[id]`**

Client page (the existing dashboard payouts page is client-side and reads under RLS). Loads the one `payout_requests` row by id with `items:payout_items(*)` under the host's own session — RLS's SELECT-own policy is the authorisation, and a row that is not theirs simply returns nothing, rendered as a "Statement not found" state. Refuses to render a `pending` or cancelled row as a statement (those have no number): show "This payout is still being prepared." / not-found respectively. Renders `<PayoutStatement>` and a Print button (`window.print()`).

- [ ] **Step 6: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add src/components/payouts/PayoutStatement.tsx src/hooks/usePayoutBalance.ts "src/app/(main)/dashboard/payouts/[id]/page.tsx" src/hooks/usePayoutRequests.ts "src/app/(main)/dashboard/payouts/page.tsx" src/types/index.ts
git commit -m "Show hosts their payout statements instead of a request button"
```

---

### Task C4: Admin — owed list, drafts, issued statements, and five routes

**Files:**
- Create: `src/app/admin/payouts/[id]/page.tsx`
- Create: `src/components/admin/PrepareStatementButton.tsx`
- Create: `src/components/admin/DraftStatementActions.tsx`
- Create: `src/components/admin/ReverseStatementAction.tsx`
- Create: `src/components/admin/ResendStatementEmailButton.tsx`
- Create: `src/app/api/admin/payout-statements/route.ts`
- Create: `src/app/api/admin/payout-statements/[id]/issue/route.ts`
- Create: `src/app/api/admin/payout-statements/[id]/cancel/route.ts`
- Create: `src/app/api/admin/payout-statements/[id]/reverse/route.ts`
- Create: `src/app/api/admin/payout-statements/[id]/resend-email/route.ts`
- Modify: `src/app/admin/payouts/page.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/reports/page.tsx`
- Modify: `src/lib/admin-reports.ts`
- Delete: `src/app/api/admin/payout-requests/[id]/paid/route.ts`
- Delete: `src/app/api/admin/payout-requests/[id]/failed/route.ts`
- Delete: `src/components/admin/PayoutRequestActions.tsx`

**Interfaces:**
- Consumes: `payouts_owed(p_host_id)` (C1, service role); the four lifecycle RPCs (C1); `<PayoutStatement>` (C3); `notifyPayoutStatementIssued` / `notifyPayoutStatementReversed` (C5 — this task may be implemented before C5 lands, in which case wire the calls and let C5 supply the functions; order the two tasks so the build is green at each commit, i.e. do C5 first if the reviewer prefers a green tree at every commit).
- Produces routes, all `requireAdminApi()` and all passing `gate.email` to the RPC:
  - `POST /api/admin/payout-statements` `{ hostId: string; expectedAmount: number }` → `200 { request }` | `400 { error }`
  - `POST /api/admin/payout-statements/[id]/issue` `{ reference: string; transferredOn: string }` (YYYY-MM-DD) → `200 { request, emailed: boolean }`
  - `POST /api/admin/payout-statements/[id]/cancel` `{ reason: string }` → `200 { request }`
  - `POST /api/admin/payout-statements/[id]/reverse` `{ reason: string; confirmStatementNumber: string }` → `200 { request, emailed: boolean }`
  - `POST /api/admin/payout-statements/[id]/resend-email` `{}` → `200 { emailed: boolean }`
- Produces (TS): `src/lib/admin-reports.ts` **deletes** `getUnrequestedPayouts`, `UnrequestedPayouts` and `UnrequestedPayoutRow`; adds `getPayoutsOwed(): Promise<OwedRow[]>` where `OwedRow = { hostId: string; hostName: string; sublabel: string; bookings: number; amount: number; blocker: string | null }`, backed by `payouts_owed()` rather than a TS mirror.

- [ ] **Step 1: `getPayoutsOwed()` replaces the TS mirror**

In `src/lib/admin-reports.ts`, delete `getUnrequestedPayouts` and its two interfaces entirely — the whole point of the SQL function is that there is now **one** definition of eligibility, and leaving the mirror in place recreates the drift the spec set out to remove. Add:

```ts
/**
 * What each host is owed right now, from payouts_owed() — the SAME SQL
 * predicate create_payout_statement itemizes with. This is deliberately NOT a
 * TypeScript mirror: the previous getUnrequestedPayouts() was one, and keeping
 * a second copy of an eligibility rule is exactly the drift 082 collapsed.
 */
export async function getPayoutsOwed(): Promise<OwedRow[]>
```

It calls `admin.rpc('payouts_owed', { p_host_id: null })`, then enriches each row with the host's name, the deleted-account sublabel (`deletedSublabel`, kept) and the **blocker** column, computed in `create_payout_statement`'s own guard order so the blocker shown is the one the admin would actually hit:

1. `Suspended — payouts on hold`
2. `No payout account`
3. `Payout account awaiting review`
4. `Payout account rejected`
5. `Draft statement open`
6. `null` — nothing is stopping a payout.

Sorted by amount descending.

- [ ] **Step 2: `/admin/payouts` rewritten as four sections**

1. **Payout accounts awaiting review** — unchanged.
2. **Owed to hosts** — `getPayoutsOwed()`. Columns: host (with the existing suspension badge), bookings, amount, blocker. **Prepare statement** button enabled only when `blocker === null`, posting `{ hostId, expectedAmount: row.amount }` — the amount the admin is looking at, so a concurrent change is refused by the RPC rather than silently absorbed.
3. **Drafts** (`status = 'pending'`) — the account **snapshot** (`account_method`/`account_name`/`account_number`), the item breakdown (`booking_ref`, `listing_title`, dates, amount), the total, and — when the host's *current* `payout_accounts` row differs from the snapshot — a warning, verbatim:

   > Account changed since this draft — cancel and re-prepare unless you already sent it.

   Issuing is **not** refused on a mismatch: if the admin already transferred, refusing to record a real transfer is worse than recording it. Actions: **Record transfer** (reference + transfer date, date defaulted to today and `max` = today) and **Cancel draft** (reason, required).
4. **Issued** — a table of `status = 'paid'` plus reversed rows: statement number, host, amount, transfer date, reference, status (Paid / Reversed), emailed state (`statement_emailed_at` → the date, else **"Email not sent — Resend"** as a link to the detail page), and a link to `/admin/payouts/[id]`.

Suspension badges are computed exactly as the current page does (`profiles.suspended_at` for the host ids on screen).

- [ ] **Step 3: `/admin/payouts/[id]`**

Server page (`requireAdminPage()` runs in the layout; `force-dynamic`). Loads the request with `payout_items(*)` via the service-role client and renders `<PayoutStatement>`, plus: **Print**, **Resend email** (`ResendStatementEmailButton`), and, for an issued, not-yet-reversed statement, **Reverse** (`ReverseStatementAction` — reason textarea plus an input in which the admin must type the statement number exactly; the button stays disabled until it matches, and the route re-checks). The reverse confirmation copy states plainly that reversing releases the bookings and the host will be owed again, so reversing a transfer that *did* arrive can double-pay.

- [ ] **Step 4: The five routes**

Each follows the existing `payout-requests/[id]/paid` shape: `requireAdminApi()`, JSON parse guard, explicit body validation returning 400 before the RPC, `createAdminClient().rpc(...)`, `400` with the RPC's message stripped of its `ERROR: …:` prefix on error.

- **Create** — `hostId` must be a UUID; `expectedAmount` a positive integer.
- **Issue** — `reference` a non-empty trimmed string ≤ 100 chars; `transferredOn` matching `^\d{4}-\d{2}-\d{2}$` and parsing to a real date. On success, calls `notifyPayoutStatementIssued(request.id)`; **awaited**, not fire-and-forget, because its result decides `statement_emailed_at`. On a successful send the route sets `statement_emailed_at = now()` with the service role and returns `{ request, emailed: true }`; on failure it logs and returns `{ request, emailed: false }` — the transfer is still recorded, and the admin page shows "Email not sent — Resend" rather than the failure vanishing.
- **Cancel** — `reason` non-empty trimmed. No email.
- **Reverse** — `reason` non-empty trimmed; `confirmStatementNumber` must equal the row's `statement_number` (re-read with the service role before calling the RPC; mismatch → `400 "The statement number you typed does not match."`). On success, awaits `notifyPayoutStatementReversed(request.id)` and returns `{ request, emailed }`.
- **Resend email** — re-reads the row; refuses (`400`) unless it has a `statement_number`; sends the issued or reversed email depending on `reversed_at`; sets `statement_emailed_at` on success.

- [ ] **Step 5: Delete the old surface**

Delete the two `payout-requests/[id]` routes and `PayoutRequestActions.tsx`. Grep to prove nothing imports them:

```bash
grep -rn "PayoutRequestActions\|payout-requests/" src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 6: `/admin` overview and `/admin/reports`**

- `/admin` — replace the "Pending payout requests" card with **"Draft payout statements"** (same `pendingCount('payout_requests')` query; only the label changes, because a `pending` row is now a draft).
- `/admin/reports` — the "Unrequested Payouts" section becomes **"Owed to hosts"**, fed by `getPayoutsOwed()`. The existing `ExportUnrequestedButton` CSV keeps working against the new row shape (its header already says "Owed", which is correct here). `MonthlyRevenue.payoutsRequestedPending`'s doc comment and the on-page caption are updated: a `pending` row is a **draft the admin has prepared**, not a host request, and the broader figure lives in the "Owed to hosts" section.

- [ ] **Step 7: Access-control check**

With a production build on 3100 and forged cookies, exercise the matrix for `/admin/payouts`, `/admin/payouts/[id]` and all five routes across signed-out / demo-renter / admin, recording each result. Expected: `307` to login on pages and `404` on routes when signed out; `404` everywhere for the demo renter; `200` on pages and a real validation error (not a stub) on routes for the admin. Check `ADMIN_EMAILS` exists in `.env.local` first — see Task B8 Step 5's warning.

- [ ] **Step 8: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add -A src/app/admin src/app/api/admin src/components/admin src/lib/admin-reports.ts
git commit -m "Let admins prepare, issue, cancel and reverse payout statements"
```

---

### Task C5: Email — issued and reversed statements

**Files:**
- Modify: `src/lib/email-templates.ts`
- Modify: `src/lib/email.ts`

**Interfaces:**
- Consumes: `payout_requests` + `payout_items` (C1) via `createAdminClient()`.
- Produces:
  - `payoutStatementIssuedHtml(ctx: PayoutStatementEmailContext): string`
  - `payoutStatementReversedHtml(ctx: PayoutStatementEmailContext): string`
  - `notifyPayoutStatementIssued(requestId: string): Promise<boolean>` — resolves `true` only when a send was actually attempted **and** returned no error; `false` on any failure or when `RESEND_API_KEY` is absent.
  - `notifyPayoutStatementReversed(requestId: string): Promise<boolean>` — same contract.
- Deletes: `notifyPayoutPaid`, `notifyPayoutFailed`, `payoutPaidBodyHtml`.
- Consumed by: Task C4's issue / reverse / resend routes, which set `statement_emailed_at` on a `true`.

- [ ] **Step 1: Templates**

```ts
export interface PayoutStatementEmailContext {
  hostName: string
  statementNumber: string
  amount: number
  transferredOn: string
  reference: string
  accountLabel: string        // "GCash •••• 4567"
  grossBookingValue: number
  serviceFeeTotal: number
  deliveryFeeTotal: number
  requestId: string
  items: {
    bookingRef: string
    listingTitle: string
    pickupDate: string
    returnDate: string
    rentalFee: number
    deliveryFee: number
    serviceFee: number
    earnings: number
  }[]
  /** Reversed only. */
  reversedOn?: string
  reversalReason?: string
}
```

Both templates build their HTML with **every** interpolated value passed through `escapeHtml` at the point of interpolation — `listingTitle` is host-authored, `reference` and `reversalReason` are admin-authored free text, `hostName` is user-set. The account number is already masked by the caller and must never be interpolated in full. Money through `fmtPeso`.

- **Issued** — the four summary lines from spec §8 in the same order and with the same definitions as `PayoutStatement.tsx`, the booking table, and the note *"The service fee was charged to renters on top of your rental price at checkout. It was not deducted from your rental rate."* CTA to `/dashboard/payouts/{requestId}`.
- **Reversed** — says the payout recorded under that number was reversed, gives the date and reason, states that the bookings it covered are owed again, and asks the host to check their payout account. CTA to `/dashboard/payouts/{requestId}`.

- [ ] **Step 2: Senders**

`notifyPayoutStatementIssued(requestId)`:

1. `createAdminClient()` reads the request with `payout_items(*)`; returns `false` if missing or if `statement_number is null`.
2. Reads the host's `full_name` from `profiles` and their email from `admin.auth.admin.getUserById`.
3. Builds the context (masking `account_number` to its last four, summing the three totals from the items exactly as `PayoutStatement.tsx` does).
4. Subject: `Payout statement ${statementNumber} — ${fmtPeso(amount)} sent`.
5. Returns whether the send succeeded. **`send()` currently returns `void` and swallows errors** — change it to return `boolean` (`false` when unconfigured or when Resend errors/throws, `true` otherwise) and leave every existing caller ignoring the value. That change is what lets the route distinguish "sent" from "not sent".

`notifyPayoutStatementReversed(requestId)` mirrors it; subject `Payout statement ${statementNumber} was reversed`.

No notification preference gates either of these: a payout statement is a financial record, like the renter-facing payment receipt, not a preference-gated marketing message.

- [ ] **Step 3: Delete the old senders and fix the account-verified copy**

Delete `notifyPayoutPaid`, `notifyPayoutFailed` and `payoutPaidBodyHtml` and their imports. In `notifyPayoutAccountReviewed`, change the approved body from "you can now request payouts for your completed bookings" to, verbatim:

> Your payout account was verified. Rentivo will send your payouts to this account.

Grep to prove nothing still imports the deleted functions:

```bash
grep -rn "notifyPayoutPaid\|notifyPayoutFailed\|payoutPaidBodyHtml" src
```

- [ ] **Step 4: Escaping check**

Extend `scripts/verify/audit2-email-escaping.mjs` (or add a sibling) to render both new templates with a hostile context — a listing title containing `<img src=x onerror=alert(1)>`, a reference containing `"><script>`, a reversal reason containing `</td></tr><script>` — and assert none of `<script`, ` onerror=` or an unescaped `<img` appears in the output, while the surrounding table structure survives.

- [ ] **Step 5: Build and commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add src/lib/email-templates.ts src/lib/email.ts scripts/verify/audit2-email-escaping.mjs
git commit -m "Email hosts their payout statement when it is issued or reversed"
```

---

### Task C6: Account deletion — the owed gate and the snapshot scrub (spec §11)

**Files:**
- Modify: `src/lib/account-deletion.ts`
- Modify: `src/app/admin/users/[id]/page.tsx`
- Modify: `src/app/api/account/delete/route.ts`
- Create: `scripts/verify/082-account-deletion-payouts.mjs`

**Interfaces:**
- Consumes: `payouts_owed(p_host_id)` (C1).
- Produces (TS): `DeletionBlocker` gains `owedAmount: number`; `EligibilityResult`'s `blocking` carries it. The self-service route maps the new reason to second-person copy exactly as it already maps the other two.

⚠️ **Standing obligation (AGENTS.md):** this task is where Phase C discharges it. `payout_requests`' new `account_name`/`account_number` snapshot columns are PII and must be anonymized; `payout_statement_counters` and `platform_settings` hold no personal data and are correctly left untouched — record that decision **in the module**, not only here.

- [ ] **Step 1: The new gate**

In `checkDeletionEligibility`, alongside the existing two gates (deliberately **not** short-circuited, so the admin UI reports everything at once), add a third:

```ts
const { data: owedData, error: owedError } = await admin.rpc('payouts_owed', { p_host_id: uid })
```

`owedAmount` = the first row's `amount`, or `0` when there is no row. A **failed** query contributes `0` and must not be read as "nothing owed" — follow the module's existing pattern exactly: report real blockers first, and only fall through to reporting a query failure if nothing else blocked. Extend the module header's ⚠️ comment to name the new field in the same list.

Gate order and copy:

1. bookings (unchanged)
2. pending payout — reason changes to: `'This account has a draft payout statement. It must be recorded or cancelled first.'`
3. owed: `` `Rentivo still owes this account ₱${owedAmount.toLocaleString('en-PH')}. It must be paid out first.` ``

The reasoning, recorded in the module: once the account is scrubbed the admin has nowhere to send the money and the host can no longer see it. A **suspended** host with a balance can be neither paid (`create_payout_statement` refuses) nor deleted — deliberately, so that decision is a person's, not a side effect.

- [ ] **Step 2: Anonymize the snapshots**

In `deleteAccount`, immediately after the existing `payout_requests.notes` scrub, add a per-row update (the last four digits differ per row, so this cannot be one blanket update):

```ts
// payout_requests' account snapshot (082). Decision: ANONYMIZE IN PLACE, same
// reasoning as payout_accounts above — the rows are the platform's record of
// money actually paid, and payout_items points at them. Statement numbers,
// amounts, references, transfer dates and every payout_items row are KEPT: that
// is the financial record. payout_items.listing_title is kept too — the listing
// row itself is anonymized above, but the snapshot IS the document.
// payout_statement_counters and platform_settings hold no personal data.
```

For each of the user's `payout_requests` rows with a non-null `account_number`: set `account_name = 'Deleted User'` and `account_number` to its last four digits (`number.slice(-4)`). Note the `payout_requests_paid_complete` constraint requires these to stay **non-null** on a `paid` row — scrubbing to a placeholder rather than nulling is what keeps that constraint satisfied.

- [ ] **Step 3: Surface it**

`src/app/admin/users/[id]/page.tsx` renders `owedAmount` when it is `> 0`, in the same block that lists blocking bookings and the draft statement. Render **only** non-empty values — per the module's own warning, a `0` may mean "not checked".

`src/app/api/account/delete/route.ts` maps the new reason to second-person copy: *"Rentivo still owes you ₱X. It must be paid out before your account can be deleted."*

- [ ] **Step 4: `scripts/verify/082-account-deletion-payouts.mjs`**

Against a dev server on 3100 with the real `POST /api/account/delete` and `POST /api/admin/users/[id]/delete` routes, using throwaway accounts only:

- **Refusal:** a throwaway host with one eligible completed+paid booking → both routes `400` with the owed message naming the exact amount from `payouts_owed`. **Control:** the same host after the booking is claimed by a committed draft statement → the *owed* gate clears and the **draft** gate blocks instead, with the "draft payout statement" message (proving the two gates are distinct and each attributable).
- **Control:** after cancelling the draft and reversing the eligibility (mark the booking `cancelled` with the service role so nothing is owed), deletion succeeds (`200`).
- **Snapshot scrub:** give a throwaway host an issued statement inside... no — an issued statement consumes a gapless number, so instead seed a `payout_requests` row directly with the service role in the shape `issue_payout_statement` produces (`status='paid'`, `statement_number='PS-2026-999999'`, reference, transferred_on, account snapshot) — **a number outside the live series** so the real counter is untouched — delete the account, then assert `account_name = 'Deleted User'`, `account_number` is exactly the original's last four, and `statement_number`, `amount`, `reference`, `transferred_on` and every `payout_items` row (including `listing_title`) are **unchanged**. Delete the seeded row afterwards and re-read to prove it is gone, and re-read `payout_statement_counters` to prove it is still `(2026, 1)`.
- **Admin gets no override:** the admin route refuses the owed host exactly as the self-service route does.
- Baselines and the forbidden host/booking checked as in Task B2.

- [ ] **Step 5: Run, build, commit**

```bash
npm run build && (PORT=3100 npm start &)
RESEND_API_KEY= node --experimental-strip-types scripts/verify/082-account-deletion-payouts.mjs
kill $(lsof -t -iTCP:3100)
npx tsc --noEmit && npm run lint && npm run build
git add src/lib/account-deletion.ts "src/app/admin/users/[id]/page.tsx" src/app/api/account/delete/route.ts scripts/verify/082-account-deletion-payouts.mjs
git commit -m "Block deletion while Rentivo owes a host, and scrub statement snapshots"
```

---

### Task C7: Migration 083 — drop the three legacy payout functions

Run this **only after** the Phase C app is deployed (Task C9 Step 4). Until then the 082 stubs are what protect an old tab.

**Files:**
- Create: `supabase/migrations/083_drop_legacy_payout_functions.sql`

**Interfaces:**
- Removes `public.request_payout()`, `public.mark_payout_paid(uuid, text)`, `public.mark_payout_failed(uuid, text)`.

- [ ] **Step 1: Prove nothing calls them**

```bash
grep -rn "request_payout\|mark_payout_paid\|mark_payout_failed" src scripts --include="*.ts" --include="*.tsx" --include="*.mjs"
```

The only permitted hits are in verification scripts asserting they raise (082's) or no longer exist (083's), and in comments. Any live call site is a hard stop.

- [ ] **Step 2: Write the migration**

```sql
-- 083: drop the legacy payout functions (spec 2026-09-14 §7.6; plan 2026-09-14).
--
-- 082 redefined these three to raise "Payouts now use statements — reload the
-- page." so an old tab could not create an un-snapshotted draft or issue a paid
-- request with no statement number in the window between applying 082 and
-- deploying the app. The new app is live; the stubs have no remaining purpose.
--
-- Guard: only drop what 082 stubbed. If a body other than the stub is found,
-- something re-created a real implementation and dropping it would destroy it.
do $$
declare v_src text;
begin
  for v_src in
    select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('request_payout', 'mark_payout_paid', 'mark_payout_failed')
  loop
    if position('Payouts now use statements' in v_src) = 0 then
      raise exception '083 aborted: a legacy payout function is not the 082 stub. Read its body before dropping it.';
    end if;
  end loop;
end $$;

drop function if exists public.request_payout();
drop function if exists public.mark_payout_paid(uuid, text);
drop function if exists public.mark_payout_failed(uuid, text);
```

- [ ] **Step 3: Apply**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/083_drop_legacy_payout_functions.sql
git commit -m "Drop the legacy payout functions (migration 083)"
```

---

### Task C8: `scripts/verify/083-drop-legacy-payout-functions.mjs`

**Files:**
- Create: `scripts/verify/083-drop-legacy-payout-functions.mjs`
- Modify: `scripts/verify/082-payout-statements.mjs` (check 12's assertion changes from "raises the stub message" to "not found")

**Interfaces:**
- Consumes: the drops in migration 083 (C7); the four lifecycle RPCs, `payouts_owed` and `my_payout_balance` from C1 as the controls that prove the *new* surface still exists.
- Produces: nothing other tasks consume — this is the last verification gate before Phase C is considered complete.

- [ ] **Step 1: Write and run**

- **Refusal:** service role calling `rpc/request_payout`, `rpc/mark_payout_paid`, `rpc/mark_payout_failed` → `404` / `PGRST202` "Could not find the function"; host session calling `request_payout` → the same (its old `authenticated` grant went with the function). Assert the error is *not-found*, distinctly from *permission denied* — a permission error would mean the function still exists.
- **Control:** the four new lifecycle RPCs plus `payouts_owed` are still callable by the service role (each returns a real validation error against a random UUID, proving it exists and ran), and `my_payout_balance` is still callable by a signed-in throwaway host.
- `supabase db query --linked` confirms `pg_proc` holds no row named `request_payout`, `mark_payout_paid` or `mark_payout_failed` in `public`.
- Baselines and the forbidden host/booking checked as in Task B2; throwaway users cleaned up and re-read.

```bash
RESEND_API_KEY= node --experimental-strip-types scripts/verify/083-drop-legacy-payout-functions.mjs
RESEND_API_KEY= node --experimental-strip-types scripts/verify/082-payout-statements.mjs   # must still pass, minus check 12
```

Check 12 of the 082 script asserts the stubs raise; after 083 they no longer exist. Update that check in the same commit to assert a **not-found** error instead, with a comment recording that the assertion changed when 083 applied — do not delete it.

- [ ] **Step 2: Commit**

```bash
git add scripts/verify/083-drop-legacy-payout-functions.mjs scripts/verify/082-payout-statements.mjs
git commit -m "Verify the legacy payout functions are gone"
```

---

### Task C9: Browser verification on a production build, deploy, and docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: everything Tasks C1–C6 produce — the lifecycle RPCs, `payouts_owed`, `my_payout_balance`, `<PayoutStatement>`, the five admin routes, both statement emails, and the account-deletion gate.
- Produces: the deployed Phase C app, which is the **precondition for Task C7** (083 must not be applied before the new app is live), and the AGENTS.md Status entry plus the TODO.md first-real-issue checklist the owner follows for `PS-2026-000002`.

- [ ] **Step 1: Serve a production build on 3100**

Same port discipline as Task B9 Step 1.

- [ ] **Step 2: The admin and host walkthrough (spec §14, last paragraph)**

Setup: a throwaway host with a verified payout account and at least one eligible completed+paid booking (driven to `completed` through the host's own session), plus a throwaway renter.

As the admin, in a real browser:

1. `/admin/payouts` → the throwaway host appears under **Owed to hosts** with the right amount, bookings count, and a blank blocker. A host with no payout account appears with "No payout account" and a disabled Prepare button.
2. Click **Prepare statement** → a draft appears under Drafts with the account snapshot and the item breakdown, and the host disappears from Owed to hosts.
3. As the throwaway host (forged SSR cookie), `/dashboard/payouts` shows **"Being prepared — ₱X"**, no Request Payout button, and the "you don't need to request it" caption. The balance card reads ₱0 (the draft claimed the bookings).
4. Back as admin, attempt **Record transfer** with a **future** transfer date → the route refuses with the RPC's own message and nothing changes. This is the refusal the spec names; observe it in the UI, not only in a script.
5. **Cancel draft** with a reason → it disappears from Drafts, the host reappears under Owed to hosts with the original amount, and the host's dashboard shows no cancelled row.
6. `/admin/payouts/PS-2026-000001`'s detail page (the legacy row) → the statement renders with the business block, the masked account, the booking table and the four summary lines, with Net matching `amount`. **Print** → the browser print preview shows the statement alone (one `#receipt-print-area` on the page). **Resend email** → with `RESEND_API_KEY` blank, the server log shows `[email] RESEND_API_KEY not set — skipped "Payout statement PS-2026-000001 …"` and the page reports "Email not sent", which is the correct honest outcome for an unconfigured key.
7. As the **demo host** (`demo@demo.rentivo.ph`, who owns the legacy payout), `/dashboard/payouts/<legacy id>` renders the same statement. As the demo **renter**, the same URL renders "Statement not found" — RLS, proven in a browser.

**Do not issue a statement in this walkthrough.** Issuing consumes a gapless number permanently; the issue path is proven inside rolled-back probes in Task C2. The first committed use of it is the owner's first real payout.

- [ ] **Step 3: Clean up**

Delete every probe row (bookings, notifications, listings, `availability_blocks`, `payout_accounts`, `payout_requests`, `payout_items`, `rate_limit_hits`, `admin_actions` rows naming probe hosts) and both throwaway users; re-read each to prove it is gone. Re-read `payout_statement_counters` to prove it is still `(2026, 1)`, and re-check baselines and the forbidden host/booking.

- [ ] **Step 4: Deploy, then apply 083**

```bash
git push origin main
```

Confirm the deploy is Ready and the new payout UI is live on `rentivo.live`, **then** run Task C7 and Task C8 (083 and its script) against production. 083 must not precede the deploy: an old tab hitting a dropped function gets a raw PostgREST 404 instead of the stub's sentence.

Production read-only checks afterwards: `/dashboard/payouts` signed out → `307`; `/admin/payouts` signed out → `307`; a bare `GET` on `/api/admin/payout-statements` → `404`; `/`, `/search` and a listing page → `200`.

- [ ] **Step 5: Docs**

`AGENTS.md`:
- Repository map: migrations `082 payout statements`, `083 drop legacy payout functions`; `src/components/payouts/PayoutStatement.tsx`; `src/hooks/usePayoutBalance.ts`; `/dashboard/payouts/[id]`; `/admin/payouts/[id]`; `/api/admin/payout-statements/*`.
- Rewrite the **Payouts** architecture bullet: a `payout_requests` row **is** the statement; the four lifecycle states and what each means to a host; the account and per-booking snapshots and why (048's redirection problem, and that a document must not change when a listing is renamed); gapless per-Manila-year numbering from a counter row and **why a sequence cannot be used**; eligibility now has exactly one definition (`payout_eligible_bookings`) and the `host_qr`/`test_skip` exclusions must never be "tidied up"; `request_payout` and the host's Request Payout button are gone; the renter pays the service fee on top, so a statement's "gross − fee = net" is true by construction and not a deduction from the host.
- Security model: table-level INSERT/UPDATE/DELETE revoked on all three payout tables; `payout_eligible_bookings` has **no** client grant because a null argument returns every host's bookings; `my_payout_balance` raises on a null `auth.uid()` for the same reason; `payout_statement_counters` has RLS with no policies.
- Account deletion: the new owed gate, the snapshot anonymization, and the explicit decisions about `payout_items.listing_title`, `payout_statement_counters` and `platform_settings`.
- A Status entry recording what was verified live and — plainly — what was **not**: the issue and reverse success paths were proven only inside rolled-back transactions, because a committed test issue would permanently occupy a gapless number with a fake payout; no statement email was observed as delivered (the local sandbox and the blank key); the concurrent-issue check's true concurrency (or the serial fallback, if that is what ran); and that the first real statement the owner issues is the first committed use of the issue path.

`TODO.md`: a done entry for admin-issued payout statements; a **checklist for the owner's first real issue** — confirm the host's payout account details match the draft's snapshot before transferring; transfer; record the transfer with the real reference and date; confirm the statement number is `PS-2026-000002` and that the host's dashboard and email both show it; if the email says "not sent", use Resend from the detail page.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md TODO.md
git commit -m "Record admin-issued payout statements"
```

---

### Task C10: Whole-branch review of Phase C

**Files:**
- Verify (no edits unless a finding requires one): the whole Phase C diff — `supabase/migrations/082_payout_statements.sql`, `supabase/migrations/083_drop_legacy_payout_functions.sql`, `src/components/payouts/PayoutStatement.tsx`, `src/hooks/usePayoutBalance.ts`, `src/hooks/usePayoutRequests.ts`, `src/app/(main)/dashboard/payouts/page.tsx`, `src/app/(main)/dashboard/payouts/[id]/page.tsx`, `src/app/admin/payouts/page.tsx`, `src/app/admin/payouts/[id]/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/reports/page.tsx`, `src/components/admin/{PrepareStatementButton,DraftStatementActions,ReverseStatementAction,ResendStatementEmailButton}.tsx`, the five `src/app/api/admin/payout-statements/**` routes, `src/lib/admin-reports.ts`, `src/lib/email.ts`, `src/lib/email-templates.ts`, `src/lib/account-deletion.ts`, `src/types/index.ts`, and the three `scripts/verify/08{2,3}-*` scripts.
- Modify: only files a finding requires.

**Interfaces:**
- Consumes: every interface Tasks C1–C9 produce.
- Produces: a deployed, reviewed Phase C — the end of this plan.

- [ ] **Step 1: Review**

Use `superpowers:requesting-code-review` against the full Phase C diff. Look specifically for cross-task relationships:

- The statement's four summary lines are computed **identically** in `PayoutStatement.tsx` and in the email template — a divergence means the host's screen and their email disagree about money.
- `Net paid to you` equals `payout_requests.amount` in every path, and the component's discrepancy warning is reachable.
- No second copy of the eligibility rule survives anywhere (`getUnrequestedPayouts` really is deleted; nothing in `src/` recomputes "completed + paid + not claimed").
- Every new function in 082 has an explicit `revoke all … from public`, and `payout_eligible_bookings` has **no** grant at all.
- `my_payout_balance`'s null-`auth.uid()` guard is present and cannot be bypassed.
- Every admin route passes `gate.email` to its RPC (the RPC writes the audit row; no route inserts `admin_actions` itself).
- `statement_emailed_at` is only ever set after a send that actually succeeded, and the admin page's "Email not sent" state is reachable.
- The four `payout_requests` check constraints cannot be violated by any RPC path, including a cancel of a draft and a reverse of an issued statement.
- Nothing in the diff can consume a statement number outside `issue_payout_statement`.
- `src/lib/account-deletion.ts`'s purge list covers every new PII column, and its header comment names them.

- [ ] **Step 2: Fix and re-verify**

Address every finding. Re-run `082-payout-statements`, `083-drop-legacy-payout-functions`, `082-account-deletion-payouts`, `audit2-email-escaping`, plus the Phase B scripts and the 076–079 regression set. `npx tsc --noEmit && npm run lint && npm run build`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Re-run the production read-only checks from Task C9 Step 4 after the deploy.

---

## Self-Review

**Spec coverage, section by section:**

- **§1 binding decisions** — one platform-wide rate (B1), per-booking stamp (B1/B3), admin-initiated payouts with numbered statements, printable, emailed, on `/dashboard/payouts` (C1/C3/C4/C5).
- **§2 live state** — re-confirmed at authoring and re-asserted by each migration's guard: `create_booking` hash `ec309539300d75e69a905942b49fa484` (B3 Step 1), booking fee split 6/13/0 (B1 Step 1), payout rows 1/0/0 (C1 Step 2), `bookings` grants (B1's comment on why no new grant is needed), function default privileges (Global Constraints → every `revoke all`), the `usePayoutRequests().availableBalance` third mirror (C3 Step 3), the false host pricing copy (B7).
- **§3.1 `platform_settings`** — B1 Step 2, including bps, the 2000 cap, and immediacy (no `effective_at` anywhere in the plan).
- **§3.2 `bookings.service_fee_bps` + backfill + abort** — B1 Step 2; verified B2 check 8.
- **§3.3 the two RPCs, audit inside the RPC, nullable `target_user_id`** — B1 Step 2; verified B2 checks 3–5, 9.
- **§4.1 `create_booking`** — B3, all five requirements: own migration, `pg_get_functiondef` capture, `CREATE OR REPLACE` with the unchanged signature (so no grant is re-issued), the md5 guard, and the four hunks written out exactly against the live body.
- **§4.2 rate-change semantics** — fixed at creation (B4 check 3's old/new control); the 409 (B5 Step 6, B6 Step 2, B9 Step 3.4); reused-booking behaviour (unchanged code, documented in B9 Step 6); payouts unaffected (C1's `payout_eligible_bookings` pays `rental_fee + delivery_fee`); refunds unchanged (nothing in the plan touches `src/lib/refunds.ts`).
- **§4.3 client mirror** — B5 Step 1 (`SERVICE_FEE_RATE` deleted, required third parameter, `serviceFeeFor`, `formatFeeRate`, `DEFAULT_SERVICE_FEE_BPS`, `StoredBookingAmounts`), the consumer table (B5 Step 5), and the "proven against Postgres over a grid including every tie" requirement (B6 Step 1). The fallback decision is in `getServiceFeeBps`'s doc comment and the opposite decision in `useServiceFeeBps`'s.
- **§4.4 copy** — B7, all four bullets verbatim.
- **§5 admin UI** — B8: page, form with two-decimal input, required reason, live preview, `confirm()` naming both rates, history table, the route with 400s before the RPC, and the overview card.
- **§6 model** — C1's header comment records the `payout_requests`-is-the-statement decision, the rejected parallel table, and reversal-as-a-column; the removal of `request_payout` and the host's button is C1 (stub), C3 Step 3/4 (UI) and C7 (drop).
- **§7.1 request columns + snapshot + four invariants** — C1 Step 3; verified C2 check 13.
- **§7.2 item columns + backfill + `not null` + amount check** — C1 Step 3; verified C2 checks 6, 14.
- **§7.3 numbering** — C1 Step 3 (counter table, RLS, no policies, revokes) and `issue_payout_statement`'s upsert; verified C2 check 8, including the after-probe counter proof.
- **§7.4 one eligibility definition** — C1's `payout_eligible_bookings` + `payouts_owed` + `my_payout_balance`; C3 Step 3 and C4 Step 1 delete the two TS mirrors; verified C2 checks 4, 5.
- **§7.5 four lifecycle RPCs** — C1 Step 3, every numbered behaviour reproduced (advisory lock, the four draft refusals, insert-then-sum, idempotency, date rules, counter increment, audit rows, suspension not blocking issue); verified C2 checks 6, 8, 9, 10.
- **§7.6 old functions + revokes** — C1 Step 3 (stubs, revokes) and C7/C8 (drop, verify); the grep for client writers is C1 Step 1.
- **§7.7 migrating existing rows** — C1 Step 3's guard, item/request backfill, `PS-2026-000001`, the counter seed, and the "any pending stays a draft" case (no `pending` row exists, and nothing in the backfill numbers one).
- **§8 statement contents** — C3 Step 1, every section and all four summary lines with their definitions and the note; the footer verbatim; `#receipt-print-area`; one component shared by both pages (C4 Step 3).
- **§9.1 admin UI** — C4: four sections on `/admin/payouts`, the detail page, the five routes, the deletions, the overview card, and reports' "Owed to hosts".
- **§9.2 host UI** — C3: balance, caption, no button, draft/issued/reversed/hidden-cancelled history, the detail page, `usePayoutBalance`, the slimmed `usePayoutRequests`; the account-verified email copy is C5 Step 3.
- **§10 email** — C5: both senders with the `boolean` contract, both templates with `escapeHtml` throughout and the masked account, `statement_emailed_at` set by the route (C4 Step 4), the "Email not sent — Resend" surface (C4 Step 2), and the three deletions.
- **§11 account deletion** — C6: the owed gate, the reworded pending gate, the snapshot anonymization, `owedAmount` on `EligibilityResult.blocking`, the admin user page, and the explicit "kept" decisions.
- **§12 out of scope** — nothing in this plan builds BIR invoices or withholding, automated disbursement, per-host/category/promotional rates, a scheduled rate change, rate-change notifications to hosts or renters, a host-deducted fee, a `payout_sent` notification type, or editing an issued statement (C4 Step 3 offers only Reverse).
- **§13 risks** — the renter-pays wording is enforced by §8's definitions and B7's copy; the "not an invoice" footer is C3 Step 1; the rate-raise risk is surfaced by the `confirm()` (B8 Step 3) and the force-dynamic legal pages (B7); the "verification touches production" risk drives B9's owner heads-up and C2's rolled-back probes; the reversal double-pay risk drives C4 Step 3's typed confirmation and C1's comment; `PS-2026-000001`'s provenance is in C1's backfill comment and C9's TODO checklist.
- **§14 verification strategy** — the rolled-back-probe technique with its two harness proofs is B2 Step 1, reused by B4 and C2; every row of the §14 table maps to a numbered check (080 → B2 checks 2–8; 081 → B4 checks 2–7 and B6; 081-route → B6 Step 2; 082 → C2 checks 2–14; 083 → C8); both browser paragraphs are B9 Step 3 and C9 Step 2.

**Placeholder scan:** no "TBD", no "add error handling", no "similar to Task N". Every SQL object is written out in full; the single body not reproduced inline is `create_booking`'s, which must be copied from the live database — the procedure, the hash guard and the four hunks are all given exactly, and the diff command that proves nothing else changed is given too. Every piece of user-facing copy the spec fixes is quoted verbatim.

**Type and signature consistency across tasks:**
- `current_service_fee_bps() → integer` (B1) is read as `number` in `getServiceFeeBps` and `useServiceFeeBps` (B5) and as `500` in B2 check 3.
- `set_service_fee_bps(integer, text, text) → table(previous_bps integer, service_fee_bps integer)` (B1) is called with `{ p_bps, p_reason, p_admin_email }` and read as `{ previous_bps, service_fee_bps }` in B8 Step 1.
- `bookings.service_fee_bps integer null` (B1) → `Booking.service_fee_bps: number | null` (B5 Step 4) → `StoredBookingAmounts.service_fee_bps: number | null` (B5 Step 1) → `payout_items.service_fee_bps integer null` (C1) → `PayoutItem.service_fee_bps: number | null` (C3).
- `calcPricing(listing, days, serviceFeeBps, isDelivery?, deliveryFeeOverride?)` has the same parameter order in its definition (B5 Step 1) and at all four call sites (B5 Step 5).
- `formatFeeRate(bps: number): string` and `serviceFeeFor(rental: number, bps: number): number` are used with those exact signatures in B5, B6, B7, B8 and C3.
- `payouts_owed(p_host_id uuid default null) → (host_id, bookings, amount)` (C1) is called with `p_host_id: null` in `getPayoutsOwed` (C4 Step 1) and with `p_host_id: uid` in account deletion (C6 Step 1); both read `amount` as a number.
- `my_payout_balance() → (bookings, amount)` (C1) is read as `{ bookings, amount }` in `usePayoutBalance` (C3 Step 2) and asserted in that shape in C2 check 4.
- The four lifecycle RPCs' parameter names in C1 match the route bodies' `p_*` keys in C4 Step 4 exactly, and each returns `public.payout_requests`, which the routes return as `{ request }` and C3/C4 render as `PayoutRequest`.
- `notifyPayoutStatementIssued` / `notifyPayoutStatementReversed` return `Promise<boolean>` (C5) and are awaited for that boolean in C4 Step 4 to decide `statement_emailed_at` — the one place a `void` return would have silently broken the "Email not sent" surface, so `send()`'s return type change (C5 Step 2) is listed as a dependency rather than left implicit.
