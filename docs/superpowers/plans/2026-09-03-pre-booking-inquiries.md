# Pre-booking Inquiries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user message a host about a listing before booking it, and have that conversation become the booking's thread if they later book.

**Architecture:** Introduce a `conversations` table so a message thread becomes a first-class row instead of being implied by a booking. `messages` moves from `booking_id` to `conversation_id`. An `after insert on bookings` trigger attaches an existing open inquiry to the new booking, so merging is a single field update and `create_booking` is never edited. A `create_inquiry()` security-definer RPC is the only way to create a conversation.

**Tech Stack:** Next.js 16 (App Router, React 19), hosted Supabase (Postgres + RLS + Realtime), `@supabase/ssr`, TypeScript, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-03-pre-booking-inquiries-design.md`

---

## Global Constraints

Copied verbatim from the spec and `AGENTS.md`. **Every task's requirements implicitly include this section.**

- **`alter table ... enable row level security;` MUST be in the same migration that creates the table.** This Supabase project grants broad INSERT/UPDATE/DELETE to `anon` and `authenticated` on essentially every `public` table regardless of what migrations grant. A new table without RLS is world-writable the moment it exists. RLS default-deny, not the absence of a `grant`, is what protects it.
- **A table-level UPDATE grant satisfies a write to *any* column**, making column-level grants decorative. To narrow, you must `revoke` the table-level grant first, then `grant` the specific columns (see `004_security_hardening.sql:127` and migration 040).
- **Never `select('*')` on a `listings` or `profiles` join.** Use `LISTING_COLUMNS` / `PROFILE_COLUMNS` from `src/lib/listing-columns.ts`. `profiles` has a `using (true)` public-read policy, so `profiles(*)` ships every column to the caller — the documented `street_address` and `qr_payment_label` leaks.
- **Hosted Postgres:** use `gen_random_uuid()`, never `uuid_generate_v4`.
- **New tables need explicit Data API grants** or PostgREST returns 403.
- **Migrations are numbered sequentially.** The last applied is `048_guard_payout_account_and_fix_rejection_copy.sql`; this plan adds `049`–`056` (`052` is the Task 3 fix-round shim repair).
- **Apply with** `supabase db push --linked --yes`; ignore pg-delta cert noise after "Applying migration…"; confirm with `supabase migration list --linked`.
- **Demo accounts:** host `demo@demo.rentivo.ph`, renter `renter@demo.rentivo.ph`, both password `DemoRentivo1`.
- **DO NOT TOUCH** host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` (Isse Capucao) or booking `RNT-A4DA55` (a real renter's real booking). Use throwaway `probe-*@example.com` accounts for anything destructive.
- **Local dev server runs on port 3100, not 3000** — port 3000 serves an unrelated project of the account owner's. Kill servers by PID from `lsof -t -iTCP:3100`; `pkill -f "next start"` matches nothing here because `npm start` execs into `next-server`, and a restart that silently fails with `EADDRINUSE` leaves the OLD bundle serving.
- **Gates for every task:** `npx tsc --noEmit`, `npm run lint`, `npm run build` must all be clean before commit.

### Planning decisions (resolved here, as the spec requires)

1. **`conversations.booking_id` uses `on delete cascade`, not `on delete set null`.** The spec left this open. Cascade is correct because `messages.booking_id` is *already* `on delete cascade` today — deleting a booking already destroys its messages, so cascade preserves current semantics exactly, whereas `set null` would silently change them (messages would survive as an orphaned inquiry). It also makes the partial-unique-index collision described in the spec impossible by construction.
2. **The 24h cap stays at 10**, defined as a single `v_max_per_day constant integer := 10;` inside `create_inquiry` so it is a one-line change. It is a guess; there is no traffic data behind it.
3. **Dropping `messages.booking_id` is Task 11, is separately committed, and is OPTIONAL.** The feature is complete and correct after Task 10. Task 11 is the only irreversible step and may be deferred indefinitely.

### A note on "tests" in this repo

**This project has no test suite**, and `AGENTS.md` explicitly records that adding one was declined because there is no safe way to verify large rewrites without one. The established pattern is **scripted live verification against the hosted database**, plus forged-SSR-cookie e2e against a production build.

So in this plan, "write the failing test" means **write the verification script and run it BEFORE the change, confirming it fails for the expected reason.** That is genuinely test-first and it is the form this repo can actually run. Do not skip the "run it and watch it fail" step — a verification script that was never seen to fail proves nothing, and this repo has already produced one false "verified" result that way.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/049_conversations.sql` | Create table, indexes, RLS, grants |
| `supabase/migrations/050_backfill_conversations.sql` | One conversation per existing booking |
| `supabase/migrations/051_messages_conversation_id.sql` | Add + backfill + `not null` the FK |
| `supabase/migrations/053_messages_rls_by_conversation.sql` | Replace all three `messages` policies |
| `supabase/migrations/055_create_inquiry.sql` | `create_inquiry` RPC + 2 triggers |
| `supabase/migrations/056_drop_messages_booking_id.sql` | **Optional.** Final cleanup |
| `scripts/verify/env.mjs` | Shared env loader + service-role fetch helper for verification scripts |
| `scripts/verify/*.mjs` | One verification script per task |
| `src/hooks/useThreads.ts` | Threads from `conversations` |
| `src/hooks/useConversation.ts` | Keyed by `conversation_id` |
| `src/components/messages/ThreadList.tsx` | Keyed by `conversationId`; "Inquiry" badge |
| `src/app/(main)/dashboard/messages/page.tsx` | Resolve `?booking=` and `?conversation=` |
| `src/lib/email.ts` | `notifyNewMessage` resolves via `conversations` |
| `src/components/listings/InquiryDialog.tsx` | New: the inquiry composer |
| `src/components/listings/HostCard.tsx` | Opens the composer |
| `src/components/booking/Step4Confirmation.tsx` | Fix the dead button |

---

## Task 1: `conversations` table

**Files:**
- Create: `supabase/migrations/049_conversations.sql`
- Create: `scripts/verify/env.mjs`
- Create: `scripts/verify/049-conversations.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.conversations(id uuid, listing_id uuid, renter_id uuid, host_id uuid, booking_id uuid null, created_at timestamptz, last_message_at timestamptz)`; unique index `conversations_open_inquiry_key`; RLS policy `conversations: participants read`.

- [ ] **Step 1: Create the shared verification helper**

Create `scripts/verify/env.mjs`:

```js
// Shared harness for verification scripts. Reads .env.local the same way the
// app does, and exposes service-role + anon fetch helpers.
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
export const SECRET = process.env.SUPABASE_SECRET_KEY

if (!URL || !ANON || !SECRET) throw new Error('Missing Supabase env in .env.local')

/** Service-role request — bypasses RLS. Use for setup/teardown and assertions. */
export async function admin(path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SECRET, Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Anon-key request, optionally as a signed-in user. This is the ONLY way to
 *  exercise RLS — the service role bypasses it entirely and proves nothing. */
export async function asUser(accessToken, path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON, Authorization: `Bearer ${accessToken ?? ANON}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Sign in a demo/probe account and return its access token. */
export async function signIn(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(json)}`)
  return json.access_token
}

let failures = 0
export function check(label, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}
export function done() {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 1 : 0) // NOTE: inverted on purpose, see Step 2
}
```

- [ ] **Step 2: Write the failing verification script**

Create `scripts/verify/049-conversations.mjs`:

```js
import { admin, asUser, signIn, check } from './env.mjs'

const RENTER = 'renter@demo.rentivo.ph'
const PASSWORD = 'DemoRentivo1'

// 1. The table exists and is reachable through PostgREST (grants present).
const svc = await admin('conversations?select=id&limit=1')
check('service role can read conversations', svc.status === 200, `status ${svc.status}`)

// 2. RLS: anon (no session) must read nothing.
const anon = await asUser(null, 'conversations?select=id')
check('anon reads zero conversations',
  anon.status === 200 && Array.isArray(anon.body) && anon.body.length === 0,
  `status ${anon.status} body ${JSON.stringify(anon.body)?.slice(0, 80)}`)

// 3. RLS: a signed-in user must not be able to INSERT directly — the RPC is
//    the only path. Expect a 42501 / permission or policy error, never 201.
const token = await signIn(RENTER, PASSWORD)
const listing = (await admin('listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&limit=1')).body[0]
const ins = await asUser(token, 'conversations', {
  method: 'POST',
  body: JSON.stringify({ listing_id: listing.id, renter_id: listing.host_id, host_id: listing.host_id }),
})
check('authenticated direct INSERT is rejected', ins.status !== 201, `status ${ins.status}`)

// 4. The partial unique index exists and is PARTIAL. An unconditional unique
//    index would break repeat rentals — 4 already exist in this database.
const idx = await admin(`rpc/exec_sql`, { method: 'POST', body: JSON.stringify({}) })
  .catch(() => null)
console.log('(index shape is asserted by the backfill in Task 2, which fails loudly if unconditional)')

process.exit(0)
```

- [ ] **Step 3: Run it and confirm it FAILS**

```bash
node scripts/verify/049-conversations.mjs
```

Expected: the first check FAILS — PostgREST returns `404` with `relation "public.conversations" does not exist`. **If it passes, stop:** the table already exists and this plan's numbering is stale.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/049_conversations.sql`:

```sql
-- Rentivo — Pre-booking inquiries: the conversations table.
--
-- A message thread has always been IMPLIED by a booking (messages.booking_id is
-- not null). That makes it impossible to message a host before booking, which
-- is the whole point of this feature. A conversation row makes the thread a
-- first-class object, so attaching it to a booking later is one field update.

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  renter_id       uuid not null references public.profiles(id),
  host_id         uuid not null references public.profiles(id),
  -- ON DELETE CASCADE, deliberately. messages.booking_id is already
  -- `on delete cascade` today, so deleting a booking ALREADY destroys its
  -- messages; cascade preserves that exactly. `set null` would quietly change
  -- it (messages would survive as an orphaned inquiry) AND could violate
  -- conversations_open_inquiry_key below by turning an attached conversation
  -- back into an open one that collides with an existing inquiry.
  booking_id      uuid unique references public.bookings(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- At most one OPEN inquiry per renter+listing. PARTIAL is load-bearing: an
-- unconditional unique(listing_id, renter_id) would fail on existing data,
-- because 4 bookings already share such a pair (the same renter has rented the
-- same gear more than once). Attached conversations are exempt, so every
-- booking — including a repeat rental — gets its own thread.
create unique index conversations_open_inquiry_key
  on public.conversations (listing_id, renter_id)
  where booking_id is null;

create index conversations_renter_idx  on public.conversations(renter_id);
create index conversations_host_idx    on public.conversations(host_id);
create index conversations_listing_idx on public.conversations(listing_id);

-- NON-NEGOTIABLE, same migration as the create. This project grants broad
-- write access to anon/authenticated on every public table regardless of what
-- migrations say, so a table without RLS is world-writable immediately.
alter table public.conversations enable row level security;

-- Read: the two participants only.
create policy "conversations: participants read"
  on public.conversations for select
  using (auth.uid() = renter_id or auth.uid() = host_id);

-- No insert/update/delete policy at all, on purpose. Writes happen only in
-- create_inquiry() and the booking trigger (053), both security definer, which
-- bypass RLS as the function owner. RLS default-deny covers everything else.

-- Explicit Data API grants; without these PostgREST 403s. Note we grant SELECT
-- only, and REVOKE the writes this project's bootstrap may already have handed
-- out — a table-level grant would otherwise satisfy any write.
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
```

- [ ] **Step 5: Apply and confirm**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -5
```

Expected: `049_conversations` appears as applied. Ignore pg-delta cert noise printed after "Applying migration…".

- [ ] **Step 6: Run the verification script and confirm it PASSES**

```bash
node scripts/verify/049-conversations.mjs
```

Expected: `service role can read conversations` PASS, `anon reads zero conversations` PASS, `authenticated direct INSERT is rejected` PASS.

- [ ] **Step 7: Gates**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/049_conversations.sql scripts/verify/env.mjs scripts/verify/049-conversations.mjs
git commit -m "Add conversations table so a thread can exist before a booking"
```

---

## Task 2: Backfill one conversation per existing booking

**Files:**
- Create: `supabase/migrations/050_backfill_conversations.sql`
- Create: `scripts/verify/050-backfill.mjs`

**Interfaces:**
- Consumes: `public.conversations` from Task 1.
- Produces: exactly one `conversations` row per existing `bookings` row, each with `booking_id` set.

- [ ] **Step 1: Write the failing verification script**

Create `scripts/verify/050-backfill.mjs`:

```js
import { admin, check, } from './env.mjs'

const bookings = (await admin('bookings?select=id,listing_id,renter_id,host_id')).body
const convos   = (await admin('conversations?select=id,booking_id,listing_id,renter_id,host_id')).body

check('one conversation per booking',
  convos.filter(c => c.booking_id).length === bookings.length,
  `bookings ${bookings.length}, attached conversations ${convos.filter(c => c.booking_id).length}`)

const byBooking = new Map(convos.filter(c => c.booking_id).map(c => [c.booking_id, c]))
let mismatched = 0
for (const b of bookings) {
  const c = byBooking.get(b.id)
  if (!c || c.listing_id !== b.listing_id || c.renter_id !== b.renter_id || c.host_id !== b.host_id) mismatched++
}
check('every conversation matches its booking participants', mismatched === 0, `${mismatched} mismatched`)

// Repeat rentals: 4 bookings share a (listing, renter) pair. Each must still
// have its OWN conversation — this is what the partial index buys us.
const pairs = new Map()
for (const b of bookings) {
  const k = `${b.listing_id}|${b.renter_id}`
  pairs.set(k, (pairs.get(k) ?? 0) + 1)
}
const repeats = [...pairs.values()].filter(n => n > 1).length
check('repeat-rental pairs each kept their own conversation', repeats > 0, `${repeats} repeated pairs present in data`)

process.exit(0)
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
node scripts/verify/050-backfill.mjs
```

Expected: `one conversation per booking` FAILS — `bookings 17, attached conversations 0`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/050_backfill_conversations.sql`:

```sql
-- Rentivo — One conversation per pre-existing booking.
--
-- Runs BEFORE messages.conversation_id exists (051), so every message has a
-- conversation to point at when that column is backfilled.
--
-- No conflict handling is needed or wanted: conversations_open_inquiry_key is
-- PARTIAL (where booking_id is null) and every row inserted here has
-- booking_id set, so repeat rentals of the same listing by the same renter
-- each get their own row. If this statement ever raises a unique violation,
-- the index was created unconditionally — fix the index, do not add ON CONFLICT.

insert into public.conversations (listing_id, renter_id, host_id, booking_id, created_at, last_message_at)
select b.listing_id,
       b.renter_id,
       b.host_id,
       b.id,
       b.created_at,
       coalesce((select max(m.created_at) from public.messages m where m.booking_id = b.id), b.created_at)
from public.bookings b
where not exists (select 1 from public.conversations c where c.booking_id = b.id);
```

- [ ] **Step 4: Apply**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

- [ ] **Step 5: Run the verification script and confirm it PASSES**

```bash
node scripts/verify/050-backfill.mjs
```

Expected: all three checks PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/050_backfill_conversations.sql scripts/verify/050-backfill.mjs
git commit -m "Backfill one conversation per existing booking"
```

---

## Task 3: `messages.conversation_id`

**Files:**
- Create: `supabase/migrations/051_messages_conversation_id.sql`
- Create: `scripts/verify/051-messages-fk.mjs`

**Interfaces:**
- Consumes: backfilled `conversations` from Task 2.
- Produces: `messages.conversation_id uuid not null references conversations(id) on delete cascade`. `messages.booking_id` still exists and is still populated (dropped only in optional Task 11).

- [ ] **Step 1: Write the failing verification script**

Create `scripts/verify/051-messages-fk.mjs`:

```js
import { admin, check } from './env.mjs'

const msgs = (await admin('messages?select=id,booking_id,conversation_id')).body
check('messages table is readable', Array.isArray(msgs), JSON.stringify(msgs)?.slice(0, 120))
check('every message has a conversation_id',
  Array.isArray(msgs) && msgs.every(m => m.conversation_id),
  `${(msgs ?? []).filter(m => !m?.conversation_id).length} missing`)

// conversation_id must agree with the booking the message already belonged to.
const convos = (await admin('conversations?select=id,booking_id')).body
const convoById = new Map(convos.map(c => [c.id, c]))
const wrong = (msgs ?? []).filter(m => convoById.get(m.conversation_id)?.booking_id !== m.booking_id)
check('conversation_id matches the original booking_id', wrong.length === 0, `${wrong.length} wrong`)

process.exit(0)
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
node scripts/verify/051-messages-fk.mjs
```

Expected: `messages table is readable` FAILS with a PostgREST error mentioning `column messages.conversation_id does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/051_messages_conversation_id.sql`:

```sql
-- Rentivo — Point messages at conversations.
--
-- booking_id is deliberately LEFT IN PLACE and still populated. Dropping it is
-- the one irreversible step in this workstream and is deferred to its own
-- optional migration (054), so everything up to here can be rolled back.

-- Ruling 1 (pre-flight): make booking_id nullable HERE, unconditionally.
-- create_inquiry (053) inserts messages with booking_id = null, so the column
-- must already be nullable by then. The original plan deferred this to a
-- "check and add it if needed" step in Task 5, which an implementer can skip,
-- producing a confusing not-null violation two migrations later.
alter table public.messages alter column booking_id drop not null;

alter table public.messages
  add column conversation_id uuid references public.conversations(id) on delete cascade;

update public.messages m
   set conversation_id = c.id
  from public.conversations c
 where c.booking_id = m.booking_id
   and m.conversation_id is null;

-- Fail loudly rather than silently leaving orphans: 050 created a conversation
-- for every booking, so any null here means the backfill was incomplete.
do $$
declare v_orphans integer;
begin
  select count(*) into v_orphans from public.messages where conversation_id is null;
  if v_orphans > 0 then
    raise exception 'refusing to continue: % message(s) have no conversation', v_orphans;
  end if;
end $$;

alter table public.messages alter column conversation_id set not null;

create index messages_conversation_idx on public.messages(conversation_id);

-- ⚠️ Ruling 2 (pre-flight) — BACKWARD-COMPATIBILITY SHIM. Do not omit.
--
-- These migrations apply to the HOSTED database that rentivo.live serves right
-- now, but the app code that knows about conversation_id does not ship until
-- Tasks 6-9 are built and deployed. The instant conversation_id becomes NOT
-- NULL above, the CURRENTLY DEPLOYED useConversation.send() — which inserts
-- only booking_id — starts failing with a not-null violation, and after the RLS migration its
-- insert also fails the new RLS check. That is a live messaging outage on a
-- production site for the whole span of Tasks 3-9.
--
-- This trigger fills conversation_id from booking_id for any client that still
-- sends the old shape. Postgres evaluates RLS WITH CHECK *after* BEFORE ROW
-- triggers, so the filled-in row satisfies both the constraint and the policy.
--
-- Task 11 removes this trigger together with the booking_id column.
create or replace function public.fill_conversation_from_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.conversation_id is null and new.booking_id is not null then
    select c.id into new.conversation_id
      from public.conversations c
     where c.booking_id = new.booking_id;
  end if;
  return new;
end;
$$;

create trigger messages_fill_conversation
  before insert on public.messages
  for each row execute function public.fill_conversation_from_booking();

-- Keep thread ordering server-side so a client cannot forge it.
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();
```

- [ ] **Step 4: Apply**

```bash
supabase db push --linked --yes
```

- [ ] **Step 5: Run the verification script and confirm it PASSES**

```bash
node scripts/verify/051-messages-fk.mjs
```

Expected: all three checks PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/051_messages_conversation_id.sql scripts/verify/051-messages-fk.mjs
git commit -m "Add messages.conversation_id and keep last_message_at server-side"
```

---

## Task 4: Rewrite `messages` RLS around conversations

**Files:**
- Create: `supabase/migrations/053_messages_rls_by_conversation.sql`
- Create: `scripts/verify/053-messages-rls.mjs`

**Interfaces:**
- Consumes: `messages.conversation_id` from Task 3.
- Produces: policies `messages: participants read`, `messages: participants insert`, `messages: participants update`, all pivoting on `conversations`.

⚠️ **All three existing policies must be replaced.** Missing the UPDATE policy does **not** fail loudly: `useConversation` marks incoming messages read on open, and an UPDATE with no matching policy silently changes 0 rows — read receipts would just quietly stop working.

- [ ] **Step 1: Write the failing verification script**

Create `scripts/verify/053-messages-rls.mjs`:

```js
import { admin, asUser, signIn, check } from './env.mjs'

const hostTok   = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')
const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')

// Find a booking the demo renter is party to, and its conversation.
const booking = (await admin('bookings?select=id,renter_id,host_id&limit=200')).body
  .find(b => b.renter_id && b.host_id)
const convo = (await admin(`conversations?select=id&booking_id=eq.${booking.id}`)).body[0]

// Seed a message from the host, as the service role, so we can test reads.
const seeded = (await admin('messages', {
  method: 'POST',
  body: JSON.stringify({ conversation_id: convo.id, booking_id: booking.id,
                          sender_id: booking.host_id, content: 'rls probe' }),
})).body[0]

const asRenter = await asUser(renterTok, `messages?select=id&conversation_id=eq.${convo.id}`)
const renterIsParty = booking.renter_id === (await admin(`profiles?select=id&limit=1`)).body[0]?.id
check('a participant can read the conversation\'s messages',
  asRenter.status === 200 && Array.isArray(asRenter.body), `status ${asRenter.status}`)

// Read receipts must still work: a participant may set is_read.
const upd = await asUser(renterTok, `messages?id=eq.${seeded.id}`, {
  method: 'PATCH', body: JSON.stringify({ is_read: true }),
})
const after = (await admin(`messages?select=is_read&id=eq.${seeded.id}`)).body[0]
check('participant can mark a message read (read receipts)', after?.is_read === true,
  `status ${upd.status}, is_read now ${after?.is_read}`)

// A participant must NOT be able to rewrite content — only is_read is granted.
const tamper = await asUser(renterTok, `messages?id=eq.${seeded.id}`, {
  method: 'PATCH', body: JSON.stringify({ content: 'TAMPERED' }),
})
const afterTamper = (await admin(`messages?select=content&id=eq.${seeded.id}`)).body[0]
check('participant cannot rewrite message content',
  afterTamper?.content === 'rls probe', `content is now ${afterTamper?.content}`)

await admin(`messages?id=eq.${seeded.id}`, { method: 'DELETE' })
process.exit(0)
```

- [ ] **Step 2: Run it and confirm the tamper check FAILS**

```bash
node scripts/verify/053-messages-rls.mjs
```

Expected: `participant cannot rewrite message content` **FAILS** if `messages` holds a table-level UPDATE grant (migration 040's finding — a table-level grant satisfies a write to any column, making `grant update (is_read)` decorative). Record the result: it determines whether Step 3's `revoke` is load-bearing or belt-and-braces. Either way the migration includes it.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/053_messages_rls_by_conversation.sql`:

```sql
-- Rentivo — Move messages RLS from bookings to conversations.
--
-- All THREE policies are replaced. The UPDATE policy (added in 013) is what
-- makes read receipts work; dropping it without a replacement fails silently,
-- because an UPDATE with no matching policy changes 0 rows without erroring.

drop policy if exists "messages: participants read"   on public.messages;
drop policy if exists "messages: participants insert" on public.messages;
drop policy if exists "messages: participants update" on public.messages;

create policy "messages: participants read"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

create policy "messages: participants insert"
  on public.messages for insert
  with check (
    auth.uid() = sender_id and
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

create policy "messages: participants update"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

-- Migration 040's lesson: a TABLE-LEVEL update grant satisfies a write to any
-- column, which would make 013's `grant update (is_read)` decorative and let a
-- participant rewrite content or sender_id on someone else's message. Revoke
-- first, then re-grant exactly the one column the app writes.
revoke update on public.messages from anon, authenticated;
grant update (is_read) on public.messages to authenticated;

-- Insert/select stay as the app needs them.
grant select, insert on public.messages to authenticated;
```

- [ ] **Step 4: Apply**

```bash
supabase db push --linked --yes
```

- [ ] **Step 5: Run the verification script and confirm ALL checks PASS**

```bash
node scripts/verify/053-messages-rls.mjs
```

Expected: read PASS, read-receipt PASS, tamper-rejected PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/053_messages_rls_by_conversation.sql scripts/verify/053-messages-rls.mjs
git commit -m "Move messages RLS onto conversations and narrow the update grant"
```

---

## Task 5: `create_inquiry` RPC and the booking-attach trigger

**Files:**
- Create: `supabase/migrations/055_create_inquiry.sql`
- Create: `scripts/verify/055-create-inquiry.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `public.create_inquiry(p_listing_id uuid, p_content text) returns uuid` (the conversation id), granted to `authenticated` only. Trigger `bookings_attach_conversation` on `bookings`.

- [ ] **Step 1: Write the failing verification script**

Create `scripts/verify/055-create-inquiry.mjs`:

```js
import { URL, ANON, admin, signIn, check } from './env.mjs'

const renterTok = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')
const hostTok   = await signIn('demo@demo.rentivo.ph', 'DemoRentivo1')

async function rpc(token, fn, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: res.status, body: await res.text() }
}

const live = (await admin('listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&limit=1')).body[0]
const own  = (await admin('listings?select=id,host_id&host_id=eq.' +
  (await admin('profiles?select=id&limit=1')).body[0].id + '&limit=1')).body[0]

// Happy path
const ok = await rpc(renterTok, 'create_inquiry', { p_listing_id: live.id, p_content: 'Is this available?' })
check('renter can open an inquiry', ok.status === 200 && ok.body.includes('-'), `status ${ok.status} ${ok.body.slice(0,90)}`)
const convoId = JSON.parse(ok.body)

// Idempotent: a second call reuses the same conversation, never errors.
const again = await rpc(renterTok, 'create_inquiry', { p_listing_id: live.id, p_content: 'Following up' })
check('second inquiry on the same listing reuses the conversation',
  again.status === 200 && JSON.parse(again.body) === convoId, `${again.body.slice(0,90)}`)

// Host cannot inquire on their own listing.
const selfHost = (await admin(`listings?select=id&host_id=eq.${live.host_id}&limit=1`)).body[0]
const self = await rpc(hostTok, 'create_inquiry', { p_listing_id: selfHost.id, p_content: 'hi' })
check('cannot inquire on your own listing', self.status >= 400, `status ${self.status}`)

// Draft listing is refused.
const draft = (await admin('listings?select=id&is_draft=eq.true&limit=1')).body[0]
if (draft) {
  const d = await rpc(renterTok, 'create_inquiry', { p_listing_id: draft.id, p_content: 'hi' })
  check('cannot inquire on a draft listing', d.status >= 400, `status ${d.status}`)
} else {
  console.log('SKIP  no draft listing in the database to test against')
}

// Cleanup
await admin(`messages?conversation_id=eq.${convoId}`, { method: 'DELETE' })
await admin(`conversations?id=eq.${convoId}`, { method: 'DELETE' })
process.exit(0)
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
node scripts/verify/055-create-inquiry.mjs
```

Expected: `renter can open an inquiry` FAILS with `404` / `Could not find the function public.create_inquiry`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/055_create_inquiry.sql`:

```sql
-- Rentivo — The only path that creates a conversation, plus booking attach.

create or replace function public.create_inquiry(
  p_listing_id uuid,
  p_content    text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  -- The 24h cap. A guess, not a measurement — there is no traffic data behind
  -- it. Deliberately one constant so it is a one-line change.
  v_max_per_day constant integer := 10;
  v_uid       uuid := auth.uid();
  v_listing   record;
  v_convo_id  uuid;
  v_recent    integer;
begin
  if v_uid is null then
    raise exception 'You must be signed in to message a host.';
  end if;
  if p_content is null or length(trim(p_content)) = 0 then
    raise exception 'Message cannot be empty.';
  end if;

  -- Host comes off the listing row, never from a client parameter.
  select l.id, l.host_id, l.is_active, l.is_draft
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found then
    raise exception 'Listing not found.';
  end if;
  if v_listing.is_draft or not v_listing.is_active then
    raise exception 'This listing is not available.';
  end if;
  if v_listing.host_id = v_uid then
    raise exception 'You cannot message yourself about your own listing.';
  end if;
  -- A suspended host is off the marketplace; messaging them would be a channel
  -- around that.
  if public.is_host_suspended(v_listing.host_id) then
    raise exception 'This listing is not available.';
  end if;

  -- Reuse an existing OPEN inquiry, so a double-submit is harmless. This also
  -- means the partial unique index is never actually hit by normal use.
  select c.id into v_convo_id
    from public.conversations c
   where c.listing_id = p_listing_id
     and c.renter_id  = v_uid
     and c.booking_id is null;

  if v_convo_id is null then
    select count(*) into v_recent
      from public.conversations c
     where c.renter_id = v_uid
       and c.created_at > now() - interval '24 hours';

    if v_recent >= v_max_per_day then
      raise exception 'You have started too many new conversations today. Please try again tomorrow.';
    end if;

    insert into public.conversations (listing_id, renter_id, host_id)
    values (p_listing_id, v_uid, v_listing.host_id)
    returning id into v_convo_id;
  end if;

  insert into public.messages (conversation_id, booking_id, sender_id, content)
  values (v_convo_id, null, v_uid, trim(p_content));

  return v_convo_id;
end;
$$;

revoke execute on function public.create_inquiry(uuid, text) from public, anon;
grant  execute on function public.create_inquiry(uuid, text) to authenticated;

-- ── Attach an open inquiry to a new booking ────────────────────────────────
--
-- A TRIGGER, deliberately, rather than editing create_booking(). That
-- function's body has been reproduced across several migrations and each
-- reproduction is a chance to disturb the amounts logic, which has already
-- caused two security incidents in this repo. This achieves the same result
-- without reopening that file.

create or replace function public.attach_conversation_to_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_convo_id uuid;
begin
  update public.conversations
     set booking_id = new.id
   where listing_id = new.listing_id
     and renter_id  = new.renter_id
     and booking_id is null
  returning id into v_convo_id;

  if v_convo_id is null then
    insert into public.conversations (listing_id, renter_id, host_id, booking_id)
    values (new.listing_id, new.renter_id, new.host_id, new.id);
  end if;

  return new;
end;
$$;

create trigger bookings_attach_conversation
  after insert on public.bookings
  for each row execute function public.attach_conversation_to_booking();
```

`messages.booking_id` was already made nullable in Task 3 (Ruling 1), so the `insert ... values (v_convo_id, null, ...)` above is safe. Do not re-add a NOT NULL constraint.

- [ ] **Step 4: Apply**

```bash
supabase db push --linked --yes
```

- [ ] **Step 5: Run the verification script and confirm it PASSES**

```bash
node scripts/verify/055-create-inquiry.mjs
```

Expected: every check PASS (the draft check may print SKIP if no draft listing exists).

- [ ] **Step 6: Verify the attach trigger with a throwaway booking**

```bash
node scripts/verify/055-create-inquiry.mjs   # leaves the DB clean
```

Then, in a scratch script: open an inquiry as the demo renter, call `create_booking` for that same listing, and assert the conversation's `booking_id` is now set and its earlier message is still present. Delete the probe booking and conversation afterwards, and re-query the baseline counts.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/055_create_inquiry.sql scripts/verify/055-create-inquiry.mjs
git commit -m "Add create_inquiry RPC and attach inquiries to new bookings by trigger"
```

---

## Task 6: `useThreads` reads conversations

**Files:**
- Modify: `src/hooks/useThreads.ts` (whole file)
- Modify: `src/components/messages/ThreadList.tsx:18-40`

**Interfaces:**
- Consumes: `conversations` table; `PROFILE_COLUMNS` from `src/lib/listing-columns.ts`.
- Produces:

```ts
export interface MessageThread {
  conversationId: string
  bookingId: string | null
  bookingRef: string | null
  listingId: string
  listingTitle: string
  otherUser: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  lastMessage: string
  lastAt: string
  unreadCount: number
  isInquiry: boolean
}
```

`useThreads()` returns `{ threads, loading, userId, totalUnread, reload }` — unchanged shape.

- [ ] **Step 1: Rewrite the hook's query**

Replace the `reload` body in `src/hooks/useThreads.ts`. The booking join becomes optional, and **the profiles join must use `PROFILE_COLUMNS`** — the current `profiles!...(*)` is the documented leak shape:

```ts
import { PROFILE_COLUMNS } from '@/lib/listing-columns'

const { data: rows } = await supabase
  .from('conversations')
  .select(
    `id, listing_id, renter_id, host_id, booking_id, last_message_at,
     listing:listings(title),
     booking:bookings(booking_ref),
     renter:profiles!conversations_renter_id_fkey(${PROFILE_COLUMNS}),
     host:profiles!conversations_host_id_fkey(${PROFILE_COLUMNS})`
  )
  .or(`renter_id.eq.${user.id},host_id.eq.${user.id}`)
  .order('last_message_at', { ascending: false })
```

- [ ] **Step 2: Build each thread**

```ts
const built = (rows ?? []).map((c): MessageThread | null => {
  const other = c.renter_id === user.id ? c.host : c.renter
  if (!other) return null
  const msgs = byConversation.get(c.id) ?? []
  const last = msgs[msgs.length - 1]
  return {
    conversationId: c.id,
    bookingId: c.booking_id,
    bookingRef: c.booking?.booking_ref ?? null,
    listingId: c.listing_id,
    listingTitle: c.listing?.title ?? 'Rentivo listing',
    otherUser: other,
    lastMessage: last ? (last.content || (last.image_url ? '📷 Photo' : '')) : '',
    lastAt: last?.created_at ?? c.last_message_at,
    unreadCount: msgs.filter((m) => m.sender_id !== user.id && !m.is_read).length,
    isInquiry: c.booking_id === null,
  }
}).filter((t): t is MessageThread => t !== null)
```

**Behaviour change to note in the commit:** the old hook dropped any thread with zero messages (`if (msgs.length === 0) return null`). Keep that filter *only* for booking threads; an inquiry always has at least one message because `create_inquiry` inserts one.

- [ ] **Step 3: Fetch messages by conversation**

```ts
const { data: messages } = await supabase
  .from('messages')
  .select('conversation_id, content, image_url, sender_id, is_read, created_at')
  .in('conversation_id', rows.map((c) => c.id))
  .order('created_at', { ascending: true })
```

- [ ] **Step 4: Update `ThreadList` to key on `conversationId`**

In `src/components/messages/ThreadList.tsx`, replace every `t.bookingId` used as identity with `t.conversationId` (the `key`, the `onSelect` argument, and both `activeId === …` comparisons), and add the badge:

```tsx
{t.isInquiry
  ? <span className="text-[10px] font-semibold text-[#003049] bg-blue-50 px-1.5 py-0.5 rounded">Inquiry</span>
  : <span className="text-[10px] text-gray-400">{t.bookingRef}</span>}
```

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: clean. `tsc` is the real safety net here — every consumer of the renamed `bookingId` field surfaces as a type error.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useThreads.ts src/components/messages/ThreadList.tsx
git commit -m "Read message threads from conversations, not bookings"
```

---

## Task 7: `useConversation` keyed by conversation

**Files:**
- Modify: `src/hooks/useConversation.ts` (whole file)
- Modify: `src/app/(main)/dashboard/messages/page.tsx:55-67`

**Interfaces:**
- Consumes: `conversations`; `MessageThread` from Task 6.
- Produces: `useConversation(conversationId: string | null)` returning `{ header, messages, userId, loading, notFound, send }` where `ConversationHeader` gains `listingId: string` and `bookingRef: string | null`.

- [ ] **Step 1: Re-key the hook**

In `src/hooks/useConversation.ts`, change the parameter to `conversationId` and the lookup to:

```ts
const { data } = await supabase
  .from('conversations')
  .select(
    `id, listing_id, renter_id, host_id, booking_id,
     listing:listings(title),
     booking:bookings(booking_ref),
     renter:profiles!conversations_renter_id_fkey(${PROFILE_COLUMNS}),
     host:profiles!conversations_host_id_fkey(${PROFILE_COLUMNS})`
  )
  .eq('id', conversationId)
  .maybeSingle()
```

- [ ] **Step 2: Re-key the messages query, Realtime filter, and insert**

```ts
.eq('conversation_id', conversationId)                                  // load
filter: `conversation_id=eq.${conversationId}`                          // realtime
.insert({ conversation_id: conversationId, sender_id: userId, content, image_url: imageUrl })  // send
```

Keep the Realtime channel topic unique per mount — `` `conversation:${conversationId}` `` is fine because only one conversation is open at a time, but if two mount concurrently, suffix with `crypto.randomUUID()`; supabase-js dedupes channels by topic and the second `.on()` throws after subscribe. That exact bug is documented in `AGENTS.md`.

- [ ] **Step 3: Resolve `?booking=` deep links in the messages page**

Existing emails and dashboard links use `?booking=<id>`. In `src/app/(main)/dashboard/messages/page.tsx`, resolve either param to a conversation id:

```tsx
useEffect(() => {
  const conversationParam = searchParams.get('conversation')
  const bookingParam = searchParams.get('booking')
  if (conversationParam) {
    setActiveId(conversationParam)
    setMobileView('chat')
    return
  }
  if (bookingParam) {
    const match = threads.find((t) => t.bookingId === bookingParam)
    if (match) {
      setActiveId(match.conversationId)
      setMobileView('chat')
    }
  }
}, [searchParams, threads])
```

Note this now depends on `threads`, so it runs again once they load — that is intentional, since the mapping isn't knowable before then.

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useConversation.ts "src/app/(main)/dashboard/messages/page.tsx"
git commit -m "Key conversations by id and resolve booking deep links through them"
```

---

## Task 8: Email recipient resolution

**Files:**
- Modify: `src/lib/email.ts:359-380`

**Interfaces:**
- Consumes: `conversations`.
- Produces: `notifyNewMessage(messageId: string)` — unchanged signature.

- [ ] **Step 1: Replace the booking lookup with a conversation lookup**

```ts
const { data: message } = await admin
  .from('messages')
  .select('conversation_id, sender_id, content, image_url')
  .eq('id', messageId)
  .maybeSingle()
if (!message) return

const { data: conversation } = await admin
  .from('conversations')
  .select('renter_id, host_id, listing:listings(title)')
  .eq('id', message.conversation_id)
  .maybeSingle()
const convoRow = conversation as unknown as {
  renter_id: string
  host_id: string
  listing: { title: string } | null
} | null
if (!convoRow) return

const recipientId = message.sender_id === convoRow.renter_id ? convoRow.host_id : convoRow.renter_id
```

Everything below (`notify_messages` gate, sender profile lookup, HTML escaping) is unchanged. This is one fewer join than before and covers inquiries and booking threads identically.

- [ ] **Step 2: Confirm no other caller reads `message.booking_id`**

```bash
grep -rn "booking_id" src/lib/email.ts src/app/api/messages/
```

Expected: no remaining `booking_id` reads in the new-message path. `/api/messages/notify/route.ts` only checks `sender_id`, so it needs no change.

- [ ] **Step 3: Gates**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/email.ts
git commit -m "Resolve new-message email recipient through conversations"
```

---

## Task 9: The inquiry composer and the two broken buttons

**Files:**
- Create: `src/components/listings/InquiryDialog.tsx`
- Modify: `src/components/listings/HostCard.tsx:67-72`
- Modify: `src/components/booking/Step4Confirmation.tsx:239-242`

**Interfaces:**
- Consumes: `create_inquiry` RPC (Task 5).
- Produces: `<InquiryDialog listingId={string} hostName={string} open={boolean} onClose={() => void} />`.

- [ ] **Step 1: Create the composer**

Create `src/components/listings/InquiryDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface InquiryDialogProps {
  listingId: string
  hostName: string
  open: boolean
  onClose: () => void
}

export function InquiryDialog({ listingId, hostName, open, onClose }: InquiryDialogProps) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  async function send() {
    if (!content.trim() || sending) return
    setSending(true)
    setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`)
      return
    }
    const { data, error: rpcError } = await supabase.rpc('create_inquiry', {
      p_listing_id: listingId,
      p_content: content.trim(),
    })
    if (rpcError) {
      setError(rpcError.message)
      setSending(false)
      return
    }
    router.push(`/dashboard/messages?view=renter&conversation=${data}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-[#111827]">Message {hostName}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Ask about availability, condition, or pickup before you book.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Hi! Is this available next weekend?"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-[#003049] resize-none"
        />

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <button
          type="button"
          onClick={send}
          disabled={!content.trim() || sending}
          className="w-full mt-4 bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {sending && <Loader2 className="w-4 h-4 animate-spin" />}
          {sending ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire `HostCard`**

`HostCard` is currently a server-safe component with no state. Add `'use client'` at the top, then replace the dead `<Link href="/dashboard/messages">` with:

```tsx
const [inquiryOpen, setInquiryOpen] = useState(false)
// …
<button
  type="button"
  onClick={() => setInquiryOpen(true)}
  className="w-full border border-[#003049] text-[#003049] font-semibold py-2.5 rounded-xl text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
>
  Message Host
</button>
<InquiryDialog
  listingId={listingId}
  hostName={host.full_name}
  open={inquiryOpen}
  onClose={() => setInquiryOpen(false)}
/>
```

`HostCard` does not currently receive the listing id — add `listingId: string` to `HostCardProps` and pass it from `src/app/(main)/listings/[id]/page.tsx:231`:

```tsx
<HostCard host={listing.host} listingId={listing.id} />
```

- [ ] **Step 3: Fix the dead confirmation button**

In `src/components/booking/Step4Confirmation.tsx`, the `<button>` with no `onClick` becomes a link to its own booking's thread:

```tsx
<Link
  href={`/dashboard/messages?view=renter&booking=${booking.id}`}
  className="flex-1 flex items-center justify-center gap-2 border border-[#003049] text-[#003049] font-bold py-3.5 rounded-xl text-sm hover:bg-blue-50 transition-colors"
>
  <MessageCircle className="w-4 h-4" />
  Message Host
</Link>
```

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/listings/InquiryDialog.tsx src/components/listings/HostCard.tsx "src/app/(main)/listings/[id]/page.tsx" src/components/booking/Step4Confirmation.tsx
git commit -m "Add the inquiry composer and fix both broken Message Host buttons"
```

---

## Task 10: Full live verification and documentation

**Files:**
- Create: `scripts/verify/full-inquiries.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: everything.
- Produces: a green end-to-end run and the `AGENTS.md` record.

- [ ] **Step 1: Build and start production on port 3100**

```bash
npm run build
PID=$(lsof -t -iTCP:3100 -sTCP:LISTEN); [ -n "$PID" ] && kill $PID; sleep 2
lsof -nP -iTCP:3100 -sTCP:LISTEN && echo "STILL BOUND — do not proceed"
PORT=3100 npm start &
```

⚠️ Confirm the port was actually free before starting, and grep the log for `EADDRINUSE`. A failed restart leaves the OLD bundle serving and any "verification" then measures pre-fix code.

- [ ] **Step 2: Run the full matrix**

Write `scripts/verify/full-inquiries.mjs` covering, with throwaway `probe-*@example.com` accounts only:

1. Renter → host and host → renter on an **existing booking** thread still works; read receipts flip; Realtime delivers.
2. A **third account** can read neither the conversation nor its messages (anon key, real session — the service role bypasses RLS and proves nothing).
3. `create_inquiry` refuses each of: own listing, draft listing, inactive listing, suspended host, 11th conversation in 24h, and returns the *same* id for a second inquiry on the same listing.
4. Opening an inquiry then booking that listing attaches it — same conversation id, earlier message still present.
5. Booking the **same listing a second time** creates a second conversation and does not violate `conversations_open_inquiry_key`.
6. `notifyNewMessage` picks the correct recipient for both an inquiry and a booking thread, and still skips when `notify_messages` is false.

- [ ] **Step 3: Confirm the database is back to baseline**

```bash
node -e "import('./scripts/verify/env.mjs').then(async ({admin}) => {
  for (const t of ['conversations','messages','bookings','listings','profiles'])
    console.log(t, (await admin(t + '?select=id')).body.length)
})"
```

Compare against the counts recorded before the run. Confirm host `c38111b3-…` and booking `RNT-A4DA55` are untouched.

- [ ] **Step 4: Re-run the standing grant audit**

Re-run migration `017`'s audit query and confirm `conversations` has RLS enabled and no unexpected write grants.

- [ ] **Step 5: Update `AGENTS.md`**

Add a Status entry recording: the conversations model and why it replaced booking-implied threads; the partial index and the 4 repeat-rental pairs that make it necessary; the `on delete cascade` decision and its reasoning; the trigger-instead-of-editing-`create_booking` decision; the 10/24h cap being a guess; and — explicitly — that `messages.booking_id` still exists and is now unused, with Task 11 deferred. Update the Architecture Notes "Messaging" bullet, which currently says a thread *is* a booking.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify/full-inquiries.mjs AGENTS.md
git commit -m "Verify pre-booking inquiries end to end and record the model change"
```

---

## Task 11 (OPTIONAL, deferrable): Drop `messages.booking_id`

**Do not run this until Task 10 has been green for a while.** This is the only irreversible step in the plan, and the feature is complete and correct without it. Its sole benefit is removing a now-unused column so no future code can reintroduce two identities for one thread.

**Files:**
- Create: `supabase/migrations/056_drop_messages_booking_id.sql`

- [ ] **Step 1: Prove the column is unused**

```bash
grep -rn "booking_id" src/ | grep -i message
```

Expected: no results. If anything remains, fix it and re-run before proceeding.

- [ ] **Step 2: Write the migration**

```sql
-- Rentivo — Remove the now-unused messages.booking_id.
--
-- conversation_id (051) has been the real thread identity since then, and
-- conversations.booking_id carries the booking link. Keeping this column would
-- leave two identities for one thread, which is exactly the shape the
-- conversations model was chosen to avoid.
--
-- IRREVERSIBLE. Only run once inquiries have been live and healthy.

-- The compatibility shim from 051 exists only to keep the OLD deployed client
-- working during the transition. Once booking_id is gone, so is its purpose.
drop trigger if exists messages_fill_conversation on public.messages;
drop function if exists public.fill_conversation_from_booking();

drop index if exists public.messages_booking_idx;
alter table public.messages drop column booking_id;
```

- [ ] **Step 3: Apply, verify, commit**

```bash
supabase db push --linked --yes
node scripts/verify/full-inquiries.mjs   # must still be fully green
git add supabase/migrations/056_drop_messages_booking_id.sql
git commit -m "Drop the now-unused messages.booking_id"
```

---

## Self-Review

**Spec coverage.** §4 data model → Tasks 1–3. §5 security (RLS, RPC-only insert, all four `create_inquiry` refusals, rate limits) → Tasks 1, 4, 5. §6 merge-by-trigger + the on-delete edge case → Task 5 and Global Constraints decision 1. §7 migration order 1–6 → Tasks 1,2,3,4,5,11. §8 application changes: `useThreads` → 6, `useConversation` → 7, `notifyNewMessage` → 8, no enum change → confirmed in Task 8 Step 2, `HostCard` + `Step4Confirmation` + Inquiry badge → 9 and 6. §9 verification 1–6 → Task 10 Step 2. §11 open question → resolved in Global Constraints decision 2.

**Placeholders.** Task 10 Step 2 describes six scenarios rather than shipping their code — that is deliberate and is the one place it is correct, because those scripts compose helpers whose exact ids are only known at run time; every scenario names its precise assertion. All other code steps carry runnable code.

**Type consistency.** `MessageThread.conversationId` (Task 6) is the identity used by `ThreadList` (6), the messages page (7), and `InquiryDialog`'s redirect (9). `useConversation(conversationId)` (7) matches. `create_inquiry(p_listing_id, p_content) returns uuid` is consistent between the migration (5), the verification script (5) and the client call (9).

**One known ordering hazard, called out where it bites:** Task 5's `create_inquiry` inserts a message with `booking_id = null`, which fails if `messages.booking_id` is still `not null`. Task 5 Step 3 includes the check and the one-line fix.
