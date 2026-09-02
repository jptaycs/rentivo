# Admin User Management & Business Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user management (suspend, delete, inspect) and platform-wide business reporting to Rentivo's `/admin` panel.

**Architecture:** Suspension is a `profiles.suspended_at` timestamp enforced at three layers (GoTrue ban for login, middleware for live sessions, an RLS predicate plus mirrored app filters for listing visibility). Deletion reuses the existing self-service anonymize path, extracted into one shared module so both callers share a single implementation. Reports are query-on-read server components — no rollup tables, no refresh job.

**Tech Stack:** Next.js 16 App Router (React 19 server components), hosted Supabase (Postgres + GoTrue + RLS), `@supabase/ssr` cookie sessions, Tailwind 4, Resend for email.

**Spec:** `docs/superpowers/specs/2026-09-02-admin-user-management-and-reports-design.md`

## Global Constraints

Copied verbatim from the spec and from AGENTS.md. **Every task's requirements implicitly include this section.**

- **This repo has no test suite.** There is no runner to write a failing test against. Every task's verification is a scripted Node check against the hosted Supabase project (the pattern used throughout this repo's history), plus `npm run build` and `npm run lint`. Do not introduce a test framework as part of this plan.
- **Any new table MUST have `alter table ... enable row level security;` in the same migration that creates it.** This Supabase project grants broad INSERT/UPDATE/DELETE to `anon` and `authenticated` on essentially every `public` table independent of what a migration grants. A new table without RLS enabled is fully world-writable the moment it exists.
- **Never add a new `profiles` or `bookings` column to migration 040's `grant update` list** unless users must edit it themselves. Anything absent from that list is server/RPC-only by default, which is the correct default for `suspended_at` and `suspension_reason`.
- **Never `select('*')` on `listings` or `profiles`.** Use `LISTING_COLUMNS` / `PROFILE_COLUMNS` from `src/lib/listing-columns.ts`. This applies to service-role queries too — the admin client bypasses RLS, so `*` pulls every column of every profile into an RSC payload.
- **A new enum value cannot be used in the transaction that adds it.** If any task needs one, it goes in its own migration. (No task in this plan adds an enum value.)
- **Migration numbering starts at 044.** The last applied migration is 043.
- **Apply migrations with** `supabase db push --linked --yes`, then confirm with `supabase migration list --linked`. Ignore the pg-delta certificate warning printed after "Applying migration…" — it is a known, harmless CLI issue in this project.
- **Real user data is never touched.** In particular host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` (Isse Capucao) and booking `RNT-A4DA55`. Every probe row a task creates must be deleted by that same task, with the surrounding counts confirmed restored.
- **Demo accounts for verification:** host `demo@demo.rentivo.ph`, renter `renter@demo.rentivo.ph`, both password `DemoRentivo1`. Never suspend or delete a demo account — create a throwaway account for destructive tests.
- **Currency is PHP,** formatted `₱X,XXX`. Primary color `#003049`. Never use the cream accent `#FDF0D5` as a text or icon color on a light background.
- **Admin gate:** `requireAdminPage()` in pages/layouts, `requireAdminApi()` in routes, both from `src/lib/admin.ts`. Non-admins get **404, never 403** — the panel's existence is not disclosed.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `supabase/migrations/044_admin_user_management.sql` | `profiles.suspended_at`/`suspension_reason`, `admin_actions` table |
| `supabase/migrations/045_suspension_visibility.sql` | Listings RLS predicate, `increment_listing_view`, `create_booking` redefine |
| `src/lib/account-deletion.ts` | Shared eligibility + anonymize/purge logic, called by both delete routes |
| `src/lib/admin-reports.ts` | Server-only report queries and the commission definitions |
| `src/lib/csv.ts` | One correctly-escaping CSV helper |
| `src/app/admin/users/page.tsx` | User list: search, role/suspension filters |
| `src/app/admin/users/[id]/page.tsx` | User detail + action buttons |
| `src/app/admin/users/[id]/UserActions.tsx` | Client component: suspend/unsuspend/delete buttons and dialogs |
| `src/app/admin/reports/page.tsx` | The four reports |
| `src/app/admin/reports/ReportExports.tsx` | Client component: CSV download buttons |
| `src/app/api/admin/users/[id]/suspend/route.ts` | POST suspend |
| `src/app/api/admin/users/[id]/unsuspend/route.ts` | POST unsuspend |
| `src/app/api/admin/users/[id]/delete/route.ts` | POST delete |

**Modified:** `src/lib/listings.ts` (5 read paths), `src/lib/hosts.ts` (1), `src/lib/email.ts` (2 senders), `src/lib/supabase/middleware.ts` (session check), `src/app/(auth)/login/page.tsx` or its form component (suspended banner), `src/app/api/account/delete/route.ts` (call the extracted module), `src/app/admin/layout.tsx` (nav), `src/app/admin/page.tsx` (overview cards), `src/types/index.ts` (`Profile` fields), `AGENTS.md` (final task).

---

### Task 1: Migration 044 — schema

**Files:**
- Create: `supabase/migrations/044_admin_user_management.sql`
- Modify: `src/types/index.ts` (add the two fields to `Profile`)

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles.suspended_at timestamptz | null`, `profiles.suspension_reason text | null`, and table `admin_actions(id uuid, admin_email text, action text, target_user_id uuid, detail jsonb, created_at timestamptz)`. Every later task reads or writes these names.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply it**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

Expected: `044` appears in both `local` and `remote`.

- [ ] **Step 3: Add the fields to the `Profile` type**

In `src/types/index.ts`, add to the `Profile` interface:

```ts
  suspended_at: string | null
  suspension_reason: string | null
```

- [ ] **Step 4: Verify the schema and the grant posture**

Create `./.verify-044.mjs` in the repo root (so `node_modules` resolves), run it, then delete it:

```js
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth:{persistSession:false} })
const ok = (c,m)=>console.log(`${c?'  PASS':'✗ FAIL'}  ${m}`)

// columns exist and are readable by the service role
const { error: colErr } = await admin.from('profiles').select('id,suspended_at,suspension_reason').limit(1)
ok(!colErr, `profiles.suspended_at/suspension_reason readable (${colErr?.message ?? 'ok'})`)

// admin_actions is writable by the service role
const { data: row, error: insErr } = await admin.from('admin_actions')
  .insert({ admin_email:'probe@example.com', action:'probe', target_user_id:'00000000-0000-0000-0000-000000000000', detail:{probe:true} })
  .select().single()
ok(!insErr, `admin_actions insert by service role (${insErr?.message ?? 'ok'})`)

// a signed-in normal user must NOT be able to write suspended_at, nor read admin_actions
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} })
const { data: sess } = await anon.auth.signInWithPassword({ email:'renter@demo.rentivo.ph', password:'DemoRentivo1' })
const { error: updErr } = await anon.from('profiles').update({ suspended_at: new Date().toISOString() }).eq('id', sess.user.id)
ok(!!updErr && /permission denied/i.test(updErr.message), `self-suspend write denied (${updErr?.message ?? 'NO ERROR — HOLE'})`)
const { data: read } = await anon.from('admin_actions').select('id')
ok(!read || read.length === 0, `admin_actions not readable by authenticated (${read?.length ?? 0} rows)`)

if (row) await admin.from('admin_actions').delete().eq('id', row.id)
const { count } = await admin.from('admin_actions').select('*',{count:'exact',head:true})
ok(count === 0, `probe row cleaned up (${count} rows left)`)
```

Run: `node ./.verify-044.mjs; rm -f ./.verify-044.mjs`
Expected: all PASS. **If "self-suspend write denied" fails, stop** — the column is user-writable and the whole feature is decorative.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/044_admin_user_management.sql src/types/index.ts
git commit -m "Add suspension columns and admin_actions audit table"
```

---

### Task 2: Migration 045 — suspension enforcement in the database

**Files:**
- Create: `supabase/migrations/045_suspension_visibility.sql`

**Interfaces:**
- Consumes: `profiles.suspended_at` from Task 1.
- Produces: no new callable names. Changes the behavior of the `listings: public read active` RLS policy, `increment_listing_view(uuid)`, and `create_booking(...)` so a suspended host's listings are invisible and unbookable.

- [ ] **Step 1: Read the authoritative `create_booking` body**

Run: `sed -n '1,200p' supabase/migrations/038_delivery_fee.sql`

`038` holds the authoritative definition. You will copy its **entire** `create_booking` body into 045 verbatim and add one guard. Do not hand-edit the function in place and do not retype it from memory — the amounts logic in it is load-bearing and has been the subject of two separate security incidents in this repo.

- [ ] **Step 2: Write the migration**

```sql
-- 045_suspension_visibility.sql
-- A suspended host's listings leave the marketplace. Enforced in the database
-- rather than only in app code, because `authenticated` holds broad grants here
-- and every public read path must agree.
--
-- create_booking is reproduced in full from 038 (the authoritative version) with
-- a single new guard added after the listing lock — this repo's convention for
-- redefining a security-definer RPC.

-- ── 1. Listings public read ──────────────────────────────────────
drop policy if exists "listings: public read active" on public.listings;
create policy "listings: public read active"
  on public.listings for select
  using (
    is_active = true
    and is_draft = false
    and not exists (
      select 1 from public.profiles p
      where p.id = listings.host_id and p.suspended_at is not null
    )
  );

-- ── 2. View counter ──────────────────────────────────────────────
create or replace function public.increment_listing_view(p_listing_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.listings l
  set view_count = l.view_count + 1
  where l.id = p_listing_id
    and l.is_active = true
    and l.is_draft = false
    and not exists (
      select 1 from public.profiles p
      where p.id = l.host_id and p.suspended_at is not null
    );
$$;

revoke execute on function public.increment_listing_view(uuid) from public;
grant execute on function public.increment_listing_view(uuid) to anon, authenticated;

-- ── 3. create_booking ────────────────────────────────────────────
-- PASTE the complete create_booking definition from
-- supabase/migrations/038_delivery_fee.sql here, unchanged, then insert the
-- guard below immediately after the `if v_listing.host_id = v_renter then ...
-- end if;` block and before the host_qr check.
```

The guard to insert, exactly:

```sql
  -- A suspended host's gear is off the marketplace. RLS already hides it from
  -- every client read path, but this function is security definer and bypasses
  -- RLS, so without this a direct RPC call could still book a suspended host.
  if exists (
    select 1 from public.profiles p
    where p.id = v_listing.host_id and p.suspended_at is not null
  ) then
    raise exception 'Listing not found or no longer available.';
  end if;
```

The message deliberately matches the existing not-found message rather than saying "this host is suspended" — a renter has no business learning the moderation state of a stranger's account.

- [ ] **Step 3: Apply it**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

Expected: `045` in both columns.

- [ ] **Step 4: Verify enforcement end-to-end**

Create `./.verify-045.mjs`, run it, delete it. It creates a throwaway host + listing, suspends, checks, un-suspends, checks, then deletes everything it made.

```js
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth:{persistSession:false} })
const anon  = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} })
const ok = (c,m)=>console.log(`${c?'  PASS':'✗ FAIL'}  ${m}`)

const email = `probe-host-${Date.now()}@example.com`
const { data: created } = await admin.auth.admin.createUser({ email, password:'ProbeRentivo1', email_confirm:true })
const uid = created.user.id
await admin.from('profiles').update({ is_host:true, is_verified:true, full_name:'Probe Host' }).eq('id', uid)
const { data: listing } = await admin.from('listings').insert({
  host_id: uid, category:'lens', brand:'Sigma', model:'Probe', title:'ZZZ suspension probe',
  description:'Temporary row for a suspension-visibility test. Safe to delete.',
  condition:'good', daily_price:100, security_deposit:0, city:'Manila', province:'Metro Manila',
  is_draft:false, is_active:true, images:[],
}).select().single()

const visible = async () => {
  const { data } = await anon.from('listings').select('id').eq('id', listing.id)
  return (data ?? []).length === 1
}
ok(await visible(), 'listing visible to anon before suspension')

await admin.from('profiles').update({ suspended_at: new Date().toISOString(), suspension_reason:'probe' }).eq('id', uid)
ok(!(await visible()), 'listing hidden from anon while suspended')

const { error: viewErr } = await anon.rpc('increment_listing_view', { p_listing_id: listing.id })
const { data: afterView } = await admin.from('listings').select('view_count').eq('id', listing.id).single()
ok(!viewErr && afterView.view_count === 0, `view counter did not increment while suspended (count=${afterView.view_count})`)

const { data: renter } = await anon.auth.signInWithPassword({ email:'renter@demo.rentivo.ph', password:'DemoRentivo1' })
const { error: bookErr } = await anon.rpc('create_booking', {
  p_listing_id: listing.id, p_pickup_date:'2027-03-01', p_return_date:'2027-03-03',
  p_is_delivery:false, p_delivery_address:null, p_payment_method:'test_skip', p_promo_code:null,
})
ok(!!bookErr && /no longer available/i.test(bookErr.message), `create_booking rejected for suspended host (${bookErr?.message ?? 'NO ERROR — HOLE'})`)

await admin.from('profiles').update({ suspended_at:null, suspension_reason:null }).eq('id', uid)
ok(await visible(), 'listing visible again after un-suspension')

await admin.from('listings').delete().eq('id', listing.id)
await admin.auth.admin.deleteUser(uid)
const { count } = await admin.from('listings').select('*',{count:'exact',head:true}).ilike('title','ZZZ suspension probe%')
ok(count === 0, `probe listing removed (${count} left)`)
```

Run: `node ./.verify-045.mjs; rm -f ./.verify-045.mjs`
Expected: all six PASS. **The `create_booking` check is the one that must not be skipped** — it is the only guard that survives a direct RPC call.

`create_booking`'s full signature in 038 is `(p_listing_id, p_pickup_date,
p_return_date, p_is_delivery, p_delivery_address, p_payment_method,
p_renter_notes, p_promo_code)`. The script above omits `p_renter_notes` on
purpose — it has a default and supabase-js passes named arguments. Do not add it,
and do not change the function signature.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/045_suspension_visibility.sql
git commit -m "Hide suspended hosts' listings from every database read path"
```

---

### Task 3: Mirror the suspension predicate in the app read paths

**Files:**
- Modify: `src/lib/listings.ts` (lines ~61, ~76, ~91, ~106, ~148 — the five `.eq('is_draft', false)` filters)
- Modify: `src/lib/hosts.ts` (line ~28)

**Interfaces:**
- Consumes: `profiles.suspended_at` (Task 1), the RLS policy (Task 2).
- Produces: no new names. Existing exported signatures are unchanged.

- [ ] **Step 1: Understand why this is needed at all**

RLS from Task 2 already blocks these reads. This task is defence in depth **and** a correctness fix for the joined-profile case: `searchListings` uses an `!inner` join on `profiles`, and a query whose embedded resource is filtered behaves differently from one relying on the parent policy alone. Being explicit also means a future reader of `listings.ts` sees the rule without having to go read a migration.

`getListing` (line ~111) deliberately has **no** `is_draft` filter — it relies entirely on RLS. Leave it that way; Task 2 covers it. Verify this in Step 4 rather than assuming.

- [ ] **Step 2: Add the filter to the four list queries and the count**

In `src/lib/listings.ts`, each of `getFeaturedListings`, `getPopularListings`, `getBundles` and `getActiveListingCount` currently selects with `HOST_SELECT` (or a count) and filters `.eq('is_active', true).eq('is_draft', false)`. Change the select string in those four from `HOST_SELECT` to `HOST_SELECT_INNER` and add the suspension filter. Add near the existing `HOST_SELECT` definition on line ~52:

```ts
// Inner-join variant, so `host.suspended_at` can be filtered on. A suspended
// host's listings leave the marketplace — RLS (045) enforces this, and these
// filters make the rule visible at the call site rather than only in a migration.
const HOST_SELECT_INNER = `${LISTING_COLUMNS}, host:profiles!listings_host_id_fkey!inner(${PROFILE_COLUMNS})`
```

Then in each of the four, after `.eq('is_draft', false)`, add:

```ts
    .is('host.suspended_at', null)
```

`getActiveListingCount` uses a head/count query with no select of the host — give it the same inner join so the filter has something to bind to:

```ts
    .select(`id, host:profiles!listings_host_id_fkey!inner(id)`, { count: 'exact', head: true })
```

- [ ] **Step 3: Add the filter to `searchListings` and `getHostProfile`**

`searchListings` (line ~146) already uses `!inner`. After its `.eq('is_draft', false)` add:

```ts
    .is('host.suspended_at', null)
```

In `src/lib/hosts.ts`, `getHostProfile` fetches the profile and the listings separately. Add the suspension check to the **profile** query so a suspended host's public profile page 404s rather than rendering an empty shell:

```ts
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).eq('is_host', true)
      .is('suspended_at', null).maybeSingle(),
```

`PROFILE_COLUMNS` does not include `suspended_at` and does not need to — filtering does not require selecting. **Do not add `suspended_at` to `PROFILE_COLUMNS`**: that list is the public-payload allowlist, and a host's moderation state is not public information.

- [ ] **Step 4: Verify every path, including the one you didn't change**

Create `./.verify-paths.mjs`, run it, delete it. Start the app first: `PORT=3100 npm run build && PORT=3100 npm start &` (port 3100 because 3000 may be occupied by an unrelated project on this machine — check with `lsof -nP -iTCP:3000 -sTCP:LISTEN` and never kill a process you did not start).

```js
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth:{persistSession:false} })
const ok = (c,m)=>console.log(`${c?'  PASS':'✗ FAIL'}  ${m}`)
const BASE = 'http://localhost:3100'

const email = `probe-host-${Date.now()}@example.com`
const { data: created } = await admin.auth.admin.createUser({ email, password:'ProbeRentivo1', email_confirm:true })
const uid = created.user.id
await admin.from('profiles').update({ is_host:true, is_verified:true, full_name:'ZZZ Probe Host' }).eq('id', uid)
const { data: listing } = await admin.from('listings').insert({
  host_id: uid, category:'lens', brand:'Sigma', model:'PathProbe', title:'ZZZ path probe listing',
  description:'Temporary row for a read-path suspension test. Safe to delete.',
  condition:'good', daily_price:100, security_deposit:0, city:'Manila', province:'Metro Manila',
  is_draft:false, is_active:true, images:[],
}).select().single()

const pageHas = async (path, needle) => (await (await fetch(BASE+path)).text()).includes(needle)
const status  = async (path) => (await fetch(BASE+path, { redirect:'manual' })).status

for (const [label, suspended] of [['before suspension', false], ['while suspended', true]]) {
  await admin.from('profiles')
    .update({ suspended_at: suspended ? new Date().toISOString() : null, suspension_reason: suspended ? 'probe' : null })
    .eq('id', uid)
  const inSearch  = await pageHas('/search?q=PathProbe', 'ZZZ path probe listing')
  const detail    = await status(`/listings/${listing.id}`)
  const hostPage  = await status(`/hosts/${uid}`)
  console.log(`  ${label}: search=${inSearch} detail=${detail} hostProfile=${hostPage}`)
  if (!suspended) {
    ok(inSearch, 'searchListings includes the listing before suspension')
    ok(detail === 200, 'listing detail 200 before suspension')
    ok(hostPage === 200, 'host profile 200 before suspension')
  } else {
    ok(!inSearch, 'searchListings excludes the listing while suspended')
    ok(detail === 404, 'listing detail 404 while suspended (RLS only — getListing has no filter)')
    ok(hostPage === 404, 'host profile 404 while suspended')
  }
}

await admin.from('listings').delete().eq('id', listing.id)
await admin.auth.admin.deleteUser(uid)
const { count } = await admin.from('listings').select('*',{count:'exact',head:true}).ilike('title','ZZZ path probe%')
ok(count === 0, `probe listing removed (${count} left)`)
```

Run: `node ./.verify-paths.mjs; rm -f ./.verify-paths.mjs`
Expected: all PASS. The "detail 404 while suspended" line is the proof that leaving `getListing` unfiltered is safe.

Also spot-check the homepage renders (it calls `getFeaturedListings`, `getPopularListings` and `getBundles`, all three changed): `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/` → `200`.

Stop the server when done: `kill %1` (or `kill` the PID that `lsof -nP -iTCP:3100 -sTCP:LISTEN` reports).

- [ ] **Step 5: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/lib/listings.ts src/lib/hosts.ts
git commit -m "Filter suspended hosts out of every listing read path"
```

---

### Task 4: Extract account deletion into a shared module

**Files:**
- Create: `src/lib/account-deletion.ts`
- Modify: `src/app/api/account/delete/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export interface DeletionBlocker { bookings: string[]; pendingPayouts: number }
  export type EligibilityResult =
    | { ok: true }
    | { ok: false; reason: string; blocking: DeletionBlocker }
  export async function checkDeletionEligibility(uid: string): Promise<EligibilityResult>
  export async function deleteAccount(uid: string): Promise<{ ok: true } | { ok: false; error: string }>
  ```
  Task 6's admin delete route calls both.

- [ ] **Step 1: Read the route you are extracting from, in full**

Run: `cat src/app/api/account/delete/route.ts`

Every block in it carries a comment explaining a non-obvious constraint — why `payout_accounts` is scrubbed in place rather than deleted (an FK with no `on delete` clause), why storage cleanup runs *before* the row deletes (`verification_requests` holds the only record of the doc paths), why storage failures are non-fatal, why `message-images` is deliberately left alone, why the auth delete is a *soft* delete. **Carry every comment across verbatim.** They are the institutional memory for a function nobody can safely re-derive.

- [ ] **Step 2: Create the module**

`src/lib/account-deletion.ts` opens with:

```ts
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Shared account-deletion logic, called by BOTH the self-service route
 * (src/app/api/account/delete/route.ts) and the admin route
 * (src/app/api/admin/users/[id]/delete/route.ts).
 *
 * ⚠️ STANDING OBLIGATION (AGENTS.md): any new table, any new PII column on
 * `profiles`, and any new storage bucket must be added to the purge/anonymize
 * lists below. This module exists so that obligation has exactly ONE place to
 * discharge — do not copy this logic into a second caller.
 *
 * Deletion is deliberately NOT a hard delete: bookings/reviews/messages
 * reference profiles without `on delete cascade`, while profiles.id -> auth.users
 * DOES cascade, so a real auth delete would wipe the counterparty's history.
 */
```

Move the two eligibility gates into `checkDeletionEligibility`, returning the booking refs and pending-payout count so a caller can *show* what is blocking rather than only saying that something is:

```ts
export async function checkDeletionEligibility(uid: string): Promise<EligibilityResult> {
  const admin = createAdminClient()

  const { data: blocking, error: blockingError } = await admin
    .from('bookings')
    .select('booking_ref')
    .or(`renter_id.eq.${uid},host_id.eq.${uid}`)
    .in('status', ['pending', 'confirmed', 'active'])
  if (blockingError) {
    return { ok: false, reason: blockingError.message, blocking: { bookings: [], pendingPayouts: 0 } }
  }

  const { data: pendingPayout, error: payoutError } = await admin
    .from('payout_requests')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'pending')
  if (payoutError) {
    return { ok: false, reason: payoutError.message, blocking: { bookings: [], pendingPayouts: 0 } }
  }

  const refs = (blocking ?? []).map((b) => b.booking_ref as string)
  const payouts = (pendingPayout ?? []).length

  if (refs.length > 0) {
    return {
      ok: false,
      reason: 'This account has an active booking. It must complete or be cancelled first.',
      blocking: { bookings: refs, pendingPayouts: payouts },
    }
  }
  if (payouts > 0) {
    return {
      ok: false,
      reason: 'This account has a payout in progress. It must be processed first.',
      blocking: { bookings: [], pendingPayouts: payouts },
    }
  }
  return { ok: true }
}
```

`deleteAccount(uid)` contains everything after the gates, unchanged in order and in behaviour: anonymize `profiles` (including `qr_payment_url`/`qr_payment_label`), deactivate + de-address `listings`, null `bookings.delivery_address`, read `verification_requests` doc paths, clean the `avatars` / `verification-docs` / `payment-qr-codes` buckets (non-fatal, log-and-continue), scrub `payout_accounts` in place, delete the four disposable tables, then `admin.auth.admin.deleteUser(uid, true)`. Return `{ ok: false, error }` where the route previously returned a 500.

- [ ] **Step 3: Rewire the self-service route**

The route keeps its own `confirm: 'DELETE'` check, its own `getUser()` session handling, and its own HTTP status codes. Its body becomes:

```ts
  const eligibility = await checkDeletionEligibility(uid)
  if (!eligibility.ok) {
    return NextResponse.json({ error: eligibility.reason }, { status: 400 })
  }
  const result = await deleteAccount(uid)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
```

**Keep the user-facing wording the self-service route already had** for the two gates — "You have an active booking. Please wait for it to complete or cancel it before deleting your account." and "You have a payout in progress. Please wait for it to be processed before deleting your account." The module's `reason` strings are admin-facing and phrased in the third person; map them in the route rather than changing what a real user sees.

- [ ] **Step 4: Verify the self-service path still works**

This is the higher-risk half of the task — it works today and must not regress. Create `./.verify-deletion.mjs`, run it, delete it. It uses a **throwaway account only**.

```js
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth:{persistSession:false} })
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const ok = (c,m)=>console.log(`${c?'  PASS':'✗ FAIL'}  ${m}`)
const BASE = 'http://localhost:3100'

const email = `probe-del-${Date.now()}@example.com`
const { data: created } = await admin.auth.admin.createUser({ email, password:'ProbeRentivo1', email_confirm:true })
const uid = created.user.id
await admin.from('profiles').update({ full_name:'ZZZ Probe Delete', bio:'probe bio', city:'Cebu', is_host:true }).eq('id', uid)

// forge the SSR cookie, this repo's documented e2e pattern
const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type':'application/json' },
  body: JSON.stringify({ email, password:'ProbeRentivo1' }) })
const sess = await r.json()
const cookie = `sb-${ref}-auth-token=base64-` + Buffer.from(JSON.stringify(sess)).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')

const post = (body) => fetch(`${BASE}/api/account/delete`, {
  method:'POST', headers:{ 'Content-Type':'application/json', cookie }, body: JSON.stringify(body) })

const bad = await post({ confirm:'nope' })
ok(bad.status === 400, `wrong confirm text -> 400 (got ${bad.status})`)

const good = await post({ confirm:'DELETE' })
ok(good.status === 200, `delete -> 200 (got ${good.status})`)

const { data: prof } = await admin.from('profiles').select('full_name,bio,city,is_host,avatar_url').eq('id', uid).single()
ok(prof.full_name === 'Deleted User' && prof.bio === null && prof.city === null && prof.is_host === false,
   `profile anonymized (${JSON.stringify(prof)})`)

const login = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type':'application/json' },
  body: JSON.stringify({ email, password:'ProbeRentivo1' }) })
ok(login.status >= 400, `login after deletion blocked (${login.status})`)

await admin.from('profiles').delete().eq('id', uid)
await admin.auth.admin.deleteUser(uid)
```

Run with the server up on 3100. Expected: all PASS.

- [ ] **Step 5: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/lib/account-deletion.ts src/app/api/account/delete/route.ts
git commit -m "Extract account deletion into a shared module"
```

---

### Task 5: Suspension emails

**Files:**
- Modify: `src/lib/email.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export async function notifyAccountSuspended(userId: string, reason: string | null): Promise<void>
  export async function notifyAccountReinstated(userId: string): Promise<void>
  ```
  Task 6 calls both, fire-and-forget.

- [ ] **Step 1: Read the existing sender you are copying**

Run: `grep -n "export async function notifyVerificationReviewed" -A 22 src/lib/email.ts`

Note the shape: resolve the address with `emailForUser(userId)`, return early if there is none, then `send(to, subject, html)`. `send()` already no-ops with a console log when `RESEND_API_KEY` is absent — do not add your own key check.

- [ ] **Step 2: Add both senders**

Append near the other admin-decision senders:

```ts
export async function notifyAccountSuspended(userId: string, reason: string | null) {
  const to = await emailForUser(userId)
  if (!to) return
  await send(
    to,
    'Your Rentivo account has been suspended',
    adminDecisionHtml({
      heading: 'Account Suspended',
      bodyHtml:
        `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your Rentivo account has been suspended. You can't sign in, and any listings you have are no longer visible on the marketplace.</p>` +
        notesBlock(reason) +
        `<p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">If you think this is a mistake, reply to this email and we'll take another look.</p>`,
      ctaPath: '/',
      ctaLabel: 'Go to Rentivo',
    })
  )
}

export async function notifyAccountReinstated(userId: string) {
  const to = await emailForUser(userId)
  if (!to) return
  await send(
    to,
    'Your Rentivo account has been reinstated',
    adminDecisionHtml({
      heading: 'Account Reinstated',
      bodyHtml: `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your Rentivo account is active again. You can sign in as usual, and any listings you had are back on the marketplace.</p>`,
      ctaPath: '/login',
      ctaLabel: 'Sign In',
    })
  )
}
```

`notesBlock(reason)` is the existing helper used by `notifyVerificationReviewed` for reviewer notes; it renders nothing when passed `null`. Confirm its exact name with `grep -n "function notesBlock" src/lib/email.ts` before using it, and confirm `adminDecisionHtml`'s parameter names the same way — do not assume.

**The suspension email is the only place the admin's reason text reaches the user.** It is not shown on the login screen (see Task 7). Whoever writes a reason should know it will be read by that person.

- [ ] **Step 3: Verify both senders fire**

Create `./.verify-email.mjs`, run it against a running server — or simpler, call the functions directly with `npx tsx`. If `tsx` is unavailable, defer this check to Task 6 Step 5, where the routes exercise these senders and the dev-server log lines confirm the send attempt. Record which of the two you did.

Expected either way: with `RESEND_API_KEY` set, a real send attempt; without it, a console log and no throw.

- [ ] **Step 4: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/lib/email.ts
git commit -m "Add account suspension and reinstatement emails"
```

---

### Task 6: Admin suspend / unsuspend / delete routes

**Files:**
- Create: `src/app/api/admin/users/[id]/suspend/route.ts`
- Create: `src/app/api/admin/users/[id]/unsuspend/route.ts`
- Create: `src/app/api/admin/users/[id]/delete/route.ts`

**Interfaces:**
- Consumes: `checkDeletionEligibility`, `deleteAccount` (Task 4); `notifyAccountSuspended`, `notifyAccountReinstated` (Task 5); `profiles.suspended_at`, `admin_actions` (Task 1).
- Produces: three POST endpoints. Task 8's `UserActions.tsx` calls all three.

- [ ] **Step 1: Read the route pattern you are following**

Run: `cat "src/app/api/admin/verifications/[id]/review/route.ts"`

Every admin route: `requireAdminApi()` first and return the gate response as-is if it is a `NextResponse`; parse and validate the body; act through `createAdminClient()`; fire email outside the critical path with `.catch()`.

- [ ] **Step 2: Write the suspend route**

```ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAccountSuspended } from '@/lib/email'

/** ~100 years. GoTrue has no "forever", so a duration past any plausible
 *  account lifetime is the idiom. Un-suspend sets 'none'. */
const BAN_DURATION = '876000h'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Refuse to suspend an admin — including yourself. Locking the only admin out
  // of the panel would leave nobody able to undo it.
  const { data: target, error: targetError } = await admin
    .from('profiles').select('id, full_name, suspended_at').eq('id', id).maybeSingle()
  if (targetError || !target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }
  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const { isAdminEmail } = await import('@/lib/admin-emails')
  if (isAdminEmail(authUser?.user?.email)) {
    return NextResponse.json({ error: 'Admin accounts cannot be suspended.' }, { status: 400 })
  }

  // Order matters: mark the profile first. If the ban call then fails, the
  // account reads as suspended and its listings are already hidden — the safe
  // direction to fail in. The reverse order could leave a banned account that
  // still shows as active in the panel.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ suspended_at: new Date().toISOString(), suspension_reason: reason })
    .eq('id', id)
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_DURATION })
  if (banError) {
    return NextResponse.json({ error: `Profile marked suspended, but the login block failed: ${banError.message}` }, { status: 500 })
  }

  // Supabase's User type has `email?: string`, while admin_actions.admin_email
  // is `text not null` — fall back rather than letting the audit insert fail and
  // lose the record of who did this.
  await admin.from('admin_actions').insert({
    admin_email: gate.email ?? 'unknown', action: 'suspend', target_user_id: id, detail: { reason },
  })

  notifyAccountSuspended(id, reason).catch((e) => console.error('[email] notifyAccountSuspended failed', e))

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Write the unsuspend route**

Same shape, reversed, and no body required:

```ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAccountReinstated } from '@/lib/email'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  const admin = createAdminClient()

  // Lift the login ban FIRST here — the mirror of suspend's ordering. If the
  // profile update then fails, the account still reads as suspended and its
  // listings stay hidden, which is again the safe direction to fail in.
  const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
  if (banError) {
    return NextResponse.json({ error: banError.message }, { status: 500 })
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ suspended_at: null, suspension_reason: null })
    .eq('id', id)
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  await admin.from('admin_actions').insert({
    admin_email: gate.email ?? 'unknown', action: 'unsuspend', target_user_id: id, detail: null,
  })

  notifyAccountReinstated(id).catch((e) => console.error('[email] notifyAccountReinstated failed', e))

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Write the delete route**

```ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkDeletionEligibility, deleteAccount } from '@/lib/account-deletion'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { confirm?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const { isAdminEmail } = await import('@/lib/admin-emails')
  if (isAdminEmail(authUser?.user?.email)) {
    return NextResponse.json({ error: 'Admin accounts cannot be deleted.' }, { status: 400 })
  }

  // Same gates as self-service, no override. Removing a host mid-rental would
  // strand a real renter's paid booking; suspension is the escape hatch.
  const eligibility = await checkDeletionEligibility(id)
  if (!eligibility.ok) {
    return NextResponse.json({ error: eligibility.reason, blocking: eligibility.blocking }, { status: 400 })
  }

  // Audit BEFORE the delete: afterwards the profile is anonymized, so this row
  // is the only remaining record of who was removed and by whom.
  await admin.from('admin_actions').insert({
    admin_email: gate.email ?? 'unknown',
    action: 'delete',
    target_user_id: id,
    detail: { email: authUser?.user?.email ?? null, full_name: (await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()).data?.full_name ?? null },
  })

  const result = await deleteAccount(id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
```

No email on deletion — the account is gone and the address anonymized.

- [ ] **Step 5: Verify access control and behaviour**

Two parts. First, the access-control matrix — 3 routes × 3 auth states — using forged SSR cookies for the demo renter (non-admin) and the demo host (admin, on the local `ADMIN_EMAILS` allowlist). Expected: signed-out → **404** on all three; demo renter → **404** on all three; demo host → the route's real validation error (400/404), which proves the gate passed and the handler ran.

Second, the lifecycle against a **throwaway account**: suspend (200; `suspended_at` set, `suspension_reason` stored, login now fails, an `admin_actions` row with `action:'suspend'`), unsuspend (200; column nulled, login works again, second `admin_actions` row), then create an in-flight booking for it and confirm delete returns **400 with the blocking booking ref**, cancel it, and confirm delete returns 200. Delete every probe row afterwards and confirm `admin_actions` is back to its starting count.

Also confirm suspending an **admin** account returns 400 — attempt it against the demo host, which is on the local allowlist.

- [ ] **Step 6: Build, lint, commit**

```bash
npm run build && npm run lint
git add "src/app/api/admin/users"
git commit -m "Add admin suspend, unsuspend and delete routes"
```

---

### Task 7: Session-layer suspension enforcement

**Files:**
- Modify: `src/lib/supabase/middleware.ts`
- Modify: the login page's form component (find it with `grep -rln "type=\"password\"" src/app/\(auth\)/login src/components/auth`)

**Interfaces:**
- Consumes: `profiles.suspended_at` (Task 1).
- Produces: no new exports. A suspended user holding a live cookie is redirected to `/login?suspended=1` on any protected route.

- [ ] **Step 1: Understand the gap this closes**

Task 6's `ban_duration` blocks *new* logins at the auth server, but an **already-issued JWT stays valid for up to an hour**. Without this task, a host suspended mid-session keeps full dashboard access until their token expires.

- [ ] **Step 2: Add the check to the middleware**

In `updateSession`, after the existing `if (!user && isProtected)` redirect and before the `/admin` checks, add:

```ts
  // A ban blocks new logins, but an already-issued JWT stays valid for up to an
  // hour. Close that window on the routes that matter. Deliberately scoped to
  // PROTECTED_PREFIXES: those pages already hit the database, so this read costs
  // nothing there, while public browsing — the overwhelming majority of
  // requests — stays query-free.
  if (user && isProtected) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('suspended_at')
      .eq('id', user.id)
      .maybeSingle()
    if (profile?.suspended_at) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?suspended=1'
      const res = NextResponse.redirect(url)
      // Clear the session so the next request is a clean signed-out state rather
      // than looping through this same check.
      for (const c of request.cookies.getAll()) {
        if (c.name.includes('-auth-token')) res.cookies.delete(c.name)
      }
      return res
    }
  }
```

Note `profiles` has a `using (true)` public-read RLS policy, so this read works with the user's own session client and needs no service-role client in the middleware.

- [ ] **Step 3: Add the banner to the login page**

In the login form component, read the param and render above the form:

```tsx
  const suspended = useSearchParams().get('suspended') === '1'
```

```tsx
      {suspended && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This account has been suspended. If you think this is a mistake, contact support.
        </div>
      )}
```

**Do not render the suspension reason here.** It is admin-authored free text written for internal use; it reaches the user only through the Task 5 email, which the admin knows they are writing for. It also must not be readable by someone who merely knows an email address.

If the component is a server component, read the param from its `searchParams` prop instead of `useSearchParams` — check which it is before writing the code.

- [ ] **Step 4: Verify**

With the server on 3100 and a **throwaway** suspended account: forge its SSR cookie *before* suspending, suspend it, then `fetch('http://localhost:3100/dashboard/overview', { headers:{cookie}, redirect:'manual' })`.

Expected: **307/302 to `/login?suspended=1`**, and a `set-cookie` header clearing the auth token. Then confirm `GET /` and `GET /search` with the same cookie still return **200** — public browsing must not be affected. Then un-suspend and confirm `/dashboard/overview` is reachable again.

Finally, load `http://localhost:3100/login?suspended=1` in a browser (or grep the HTML) and confirm the banner text appears and **the reason string does not**.

- [ ] **Step 5: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/lib/supabase/middleware.ts src/app
git commit -m "Stop suspended users' live sessions on protected routes"
```

---

### Task 8: Admin user list and detail pages

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/app/admin/users/[id]/page.tsx`
- Create: `src/app/admin/users/[id]/UserActions.tsx`
- Modify: `src/app/admin/layout.tsx` (nav), `src/app/admin/page.tsx` (overview cards)

**Interfaces:**
- Consumes: the three routes from Task 6; `profiles.suspended_at` (Task 1); `checkDeletionEligibility` (Task 4) for the pre-flight blocking display.
- Produces: no exports other than the page components.

- [ ] **Step 1: Read the pages you are matching**

Run: `cat src/app/admin/verifications/page.tsx src/app/admin/layout.tsx`

Match the existing visual language: `export const dynamic = 'force-dynamic'`, service-role reads via `createAdminClient()`, `rounded-2xl bg-white p-6 shadow-sm` cards, `#003049` for primary text and buttons.

- [ ] **Step 2: Build the list page**

`/admin/users` accepts `?q=` (name or email substring), `?role=host|renter`, `?status=suspended|active`. It reads `profiles` with an explicit column list — **never `select('*')`**, even through the admin client:

```ts
const COLUMNS = 'id, full_name, avatar_url, city, is_host, is_verified, suspended_at, created_at'
```

Email lives in `auth.users`, not `profiles`, so resolve it with `admin.auth.admin.listUsers({ perPage: 1000 })` and join in memory by id. Note in a comment that this caps at 1000 users and will need real pagination before that matters.

Render a table: name (linking to the detail page), email, role badge (Host / Renter), verified badge, a red **Suspended** badge when `suspended_at` is set, city, joined date.

- [ ] **Step 3: Build the detail page**

`/admin/users/[id]` renders, each in its own card:

- **Profile** — name, email, avatar, city, bio, joined date, verified, host/renter, and — when suspended — a red panel with the reason and the suspension date.
- **Listings** — every listing including drafts and inactive ones (this is the admin view; use the service-role client so RLS doesn't hide them), with status badges.
- **Bookings as host** and **Bookings as renter** — ref, item, dates, status, payment status, amount.
- **Reviews** — received, with rating and text.
- **Payout account** — masked account number, status.
- **Admin action history** — the `admin_actions` rows for this user, newest first.
- **`<UserActions />`** — the client component from Step 4.

Call `checkDeletionEligibility(id)` on the server and pass the result down, so the Delete button can show what is blocking *before* the admin clicks it.

- [ ] **Step 4: Build the actions component**

`UserActions.tsx` is `'use client'`. It renders:

- **Suspend** (when active): opens a panel with a required reason textarea; `POST /api/admin/users/<id>/suspend` with `{ reason }`. Disabled with a note when the reason is empty.
- **Un-suspend** (when suspended): `POST .../unsuspend`, no body.
- **Delete**: when `eligibility.ok` is false, render it **disabled** with the blocking detail spelled out and a line pointing at Suspend — e.g. *"Blocked — 1 in-flight booking (RNT-A4DA55). Resolve it first, or suspend this account instead (suspension is always allowed)."* When eligible, require typing `DELETE` into an input, then `POST .../delete` with `{ confirm: 'DELETE' }`.

On success, `router.refresh()`. On failure, render the route's `error` string — do not swallow it.

- [ ] **Step 5: Wire the nav and overview**

In `layout.tsx`, add `<Link href="/admin/users">Users</Link>` and `<Link href="/admin/reports">Reports</Link>` to the existing `<nav>`. (The reports page arrives in Task 10; the link is added now so the nav is edited once. Note in the commit message that it 404s until Task 10.)

In `page.tsx`, add two cards alongside the three pending-count cards: total users and suspended users, both linking to `/admin/users` (the suspended card to `/admin/users?status=suspended`). The existing `pendingCount` helper filters on `status`, which `profiles` does not have — write a separate small helper rather than bending that one.

- [ ] **Step 6: Verify**

Access control: `/admin/users` and `/admin/users/<id>` × 3 auth states — signed out → 307 to `/login`, demo renter → **404**, demo host → 200.

Function, with the server on 3100 and an admin cookie: confirm the list renders real users and each filter narrows it correctly; open a detail page and confirm every card populates; confirm a user with an in-flight booking shows the Delete button **disabled with the booking ref named**; run a full suspend → un-suspend cycle through the UI and confirm the badge, the reason panel, and the action-history card all update.

- [ ] **Step 7: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/app/admin
git commit -m "Add admin user list and detail pages"
```

---

### Task 9: Report data layer

**Files:**
- Create: `src/lib/admin-reports.ts`
- Create: `src/lib/csv.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export const PAYMONGO_METHODS: readonly ['card','gcash','maya','qrph']
  export interface MonthlyRevenue { month: string; gross: number; earned: number; collected: number; uncollected: number; payoutsPaid: number; payoutsOwed: number }
  export interface InFlightRental { bookingRef: string; listingTitle: string; hostName: string; renterName: string; pickupDate: string; returnDate: string; status: string; amount: number }
  export interface RankedRow { id: string; label: string; sublabel: string; count: number; value: number }
  export interface CommissionTotals { earned: number; collected: number; uncollected: number }

  export async function getCommissionTotals(): Promise<CommissionTotals>
  export async function getMonthlyRevenue(months?: number): Promise<MonthlyRevenue[]>
  export async function getInFlightRentals(): Promise<InFlightRental[]>
  export async function getTopListings(limit?: number): Promise<RankedRow[]>
  export async function getTopHosts(limit?: number): Promise<RankedRow[]>
  export async function getTopRenters(limit?: number): Promise<RankedRow[]>
  ```
  Task 10 renders all six.

  ```ts
  export function toCsv(headers: string[], rows: (string | number | null)[][]): string
  ```

- [ ] **Step 1: Write the CSV helper**

```ts
/**
 * RFC4180-ish CSV. Every field is quoted and embedded quotes are doubled, so a
 * listing title containing a comma or a quote can't corrupt the file.
 *
 * NOTE: `/dashboard/earnings` has its own older toCsv() that quotes only some
 * fields and does not escape embedded quotes. That is a real (pre-existing) bug
 * in that page, deliberately left alone here rather than pulled into this
 * change's scope — but do not copy its approach.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}
```

- [ ] **Step 2: Write the commission definitions**

These are the substance of the whole reports feature. Get them exactly right.

```ts
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Methods where Rentivo's OWN PayMongo account processes the payment, so the
 * service fee actually reaches Rentivo.
 *
 * Written as an explicit allowlist, never as a negation: `payment_method` is
 * nullable and its enum still carries unused apple_pay/google_pay values, so a
 * future method must be deliberately classified rather than silently counted as
 * revenue.
 *
 * Excluded on purpose:
 *   host_qr   — the renter pays the host's personal GCash/Maya QR directly.
 *               Rentivo never touches this money, so the fee is earned but
 *               never collected.
 *   test_skip — the pre-launch no-charge testing method.
 */
export const PAYMONGO_METHODS = ['card', 'gcash', 'maya', 'qrph'] as const
```

Every money query uses the same base filter: `payment_status = 'paid'` and `status <> 'cancelled'`. Refunded bookings are excluded automatically because `payment_status` becomes `'refunded'`, not `'paid'` — state that in a comment so nobody later "fixes" it by adding a redundant clause.

```ts
const MONEY_SELECT = 'service_fee, rental_fee, delivery_fee, total_amount, payment_method, created_at'

async function paidBookings() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .select(MONEY_SELECT)
    // Refunded bookings are excluded for free: mark_booking_refunded moves
    // payment_status to 'refunded', so they never match 'paid'.
    .eq('payment_status', 'paid')
    .neq('status', 'cancelled')
  if (error) throw new Error(`Failed to load bookings: ${error.message}`)
  return data ?? []
}

export async function getCommissionTotals(): Promise<CommissionTotals> {
  const rows = await paidBookings()
  const earned = rows.reduce((s, b) => s + b.service_fee, 0)
  const collected = rows
    .filter((b) => b.payment_method && (PAYMONGO_METHODS as readonly string[]).includes(b.payment_method))
    .reduce((s, b) => s + b.service_fee, 0)
  return { earned, collected, uncollected: earned - collected }
}
```

- [ ] **Step 3: Write the remaining five functions**

`getMonthlyRevenue(months = 12)` buckets by `created_at` — **not `pickup_date`**; the fee is earned when the booking is paid for, not when the gear changes hands. Seed the map with every month in the window so a quiet period renders as an explicit zero row rather than being skipped. Add payouts by reading `payout_requests` (`amount`, `status`, `created_at`): `payoutsPaid` = status `paid`, `payoutsOwed` = status `pending`.

`getInFlightRentals()` reads bookings with `status in ('pending','confirmed','active')`, joining `listings` and both profiles **through `LISTING_COLUMNS` / `PROFILE_COLUMNS`**, ordered by `pickup_date`.

`getTopListings(limit = 10)` / `getTopHosts` / `getTopRenters` aggregate the same paid-and-not-cancelled set in memory (the dataset is small; a `group by` via PostgREST would need a database view for no present benefit — say so in a comment). Rank by rental count, carry total value alongside. `label`/`sublabel` are the display name and a secondary line (listing title + brand; person's name + city).

- [ ] **Step 4: Verify the numbers by hand**

Cross-check `getCommissionTotals()` against a direct SQL sum, and **make sure the uncollected column is provably non-zero rather than accidentally correct** — the database already contains at least one `host_qr` and one `test_skip` booking; confirm both are present before trusting a zero.

```js
const { data } = await admin.from('bookings')
  .select('service_fee,payment_method').eq('payment_status','paid').neq('status','cancelled')
const earned = data.reduce((s,b)=>s+b.service_fee,0)
const collected = data.filter(b=>['card','gcash','maya','qrph'].includes(b.payment_method)).reduce((s,b)=>s+b.service_fee,0)
console.log({ earned, collected, uncollected: earned-collected,
  methods: [...new Set(data.map(b=>b.payment_method))] })
```

Expected: `methods` contains at least one of `host_qr` / `test_skip`, and `uncollected > 0`. If it is zero, create a throwaway `host_qr` booking, re-check, and delete it — a zero you haven't proven is a zero you can't trust.

- [ ] **Step 5: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/lib/admin-reports.ts src/lib/csv.ts
git commit -m "Add admin report queries and commission definitions"
```

---

### Task 10: Reports page

**Files:**
- Create: `src/app/admin/reports/page.tsx`
- Create: `src/app/admin/reports/ReportExports.tsx`

**Interfaces:**
- Consumes: all six functions and the four interfaces from Task 9, plus `toCsv`.
- Produces: nothing.

- [ ] **Step 1: Build the server page**

`export const dynamic = 'force-dynamic'`. Call all six report functions in one `Promise.all`, then render four sections:

1. **Commission** — three stat cards: Earned, Collected, and Uncollected. Give Uncollected an amber treatment (`border-amber-200 bg-amber-50 text-amber-800`) with the caption *"Earned on host-QR and test bookings — this money never reached Rentivo."* **Amber, not red**: this is a fact about the business model, not an error.
2. **Revenue over time** — a table of the 12 monthly rows (month, gross, earned, collected, uncollected, payouts paid, payouts owed). A table, not a chart: this repo has no charting library and adding one for six data series is not justified. Say so in a comment.
3. **Rentals in flight** — ref, item, host, renter, dates, status, amount.
4. **Top listings / hosts / renters** — three tables side by side on wide screens, stacked on narrow.

Wide tables go in `overflow-x-auto` wrappers so the page body never scrolls horizontally.

- [ ] **Step 2: Build the export buttons**

`ReportExports.tsx` is `'use client'` and takes the already-fetched rows as props — it does not re-query. One download button per report, using `toCsv` and the existing blob-download pattern:

```tsx
  function download(filename: string, csv: string) {
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
```

Filenames: `rentivo-revenue.csv`, `rentivo-in-flight.csv`, `rentivo-top-listings.csv`, `rentivo-top-hosts.csv`, `rentivo-top-renters.csv`.

- [ ] **Step 3: Verify**

Access control: `/admin/reports` × 3 auth states — signed out → 307 to `/login`, demo renter → **404**, demo host → 200.

Content: confirm the three commission figures match Task 9 Step 4's hand-computed numbers exactly; confirm the monthly table has 12 rows including zero months; confirm rentals-in-flight lists the bookings a direct query says are `pending`/`confirmed`/`active`; download at least one CSV and confirm it opens with correct headers and quoted fields.

- [ ] **Step 4: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/app/admin/reports
git commit -m "Add admin business reports page"
```

---

### Task 11: Whole-feature verification and documentation

**Files:**
- Modify: `AGENTS.md`

**Interfaces:** none.

- [ ] **Step 1: Run the full access-control matrix in one pass**

Three new pages (`/admin/users`, `/admin/users/<id>`, `/admin/reports`) and three new routes, each × three auth states (signed out, demo renter, demo host-as-admin). Nine page results and nine route results. Record the actual status codes — do not carry forward per-task results.

Expected: signed out → 307 to `/login?next=…` on pages, **404** on routes. Demo renter → **404** everywhere. Demo host → 200 on pages, real validation errors on routes.

- [ ] **Step 2: Run one uninterrupted lifecycle on a throwaway account**

Create the account with a listing → confirm the listing is publicly visible → suspend it through the admin UI → confirm login blocked, live session bounced to `/login?suspended=1`, listing gone from search, detail page 404, host profile 404 → un-suspend → confirm all four restored → give it an in-flight booking → confirm delete is blocked with the ref named → cancel → delete → confirm the profile is anonymized and login fails.

- [ ] **Step 3: Confirm you left nothing behind**

Booking, listing, profile, `admin_actions` and `verification_requests` counts all back to their pre-run values. `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` and `RNT-A4DA55` untouched. No listing left with a `suspended_at` host.

- [ ] **Step 4: Update AGENTS.md**

Add a Status entry recording what was built and — with equal weight — **what was not verified**. Follow the honesty convention this file already uses: where an existing entry says a branch was "code-reviewed but never run against a live row", write the equivalent sentence rather than implying full coverage.

Specifically record:
- The three enforcement layers and the **1-hour JWT window** the middleware closes.
- The **six read paths** the suspension predicate had to be mirrored across, and that `getListing` deliberately relies on RLS alone.
- That `src/lib/account-deletion.ts` is now the single home of the standing "add every new table / PII column / storage bucket to the purge list" obligation — and **update that obligation's wording in the account-deletion architecture note to point at the module instead of the route.**
- The commission definitions verbatim, including that `host_qr` and `test_skip` earn a fee that is never collected.
- That `admin_actions` has RLS enabled with no policies by design.

Then move the "Admin: host/renter management, commission tracking, and a reports tab" line out of **To Do** and into **Status — Done**.

- [ ] **Step 5: Final build, lint, commit**

```bash
npm run build && npm run lint
git add AGENTS.md
git commit -m "Document admin user management and reports"
```
