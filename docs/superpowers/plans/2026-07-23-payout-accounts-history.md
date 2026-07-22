# Payout Accounts & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fully-mocked `/dashboard/payouts` page with real data: hosts store one payout account, see a real available balance, request a payout against completed+paid bookings, and see real payout history. Actual money movement stays manual/admin-run via SQL-editor RPCs — no live disbursement API.

**Architecture:** New migration `020_payout_accounts.sql` adds `payout_accounts` (one row per host, written only via `set_payout_account()`), `payout_requests`, and `payout_items` (itemizing which completed bookings a request covers), all RLS-enabled with read-only grants to `authenticated` — every write goes through a `security definer` RPC. Two new client hooks (`usePayoutAccount`, `usePayoutRequests`) mirror the existing `useBookings.ts` pattern (`createClient()` + `useState`/`useEffect`, no TanStack Query). The Payouts page swaps its hardcoded arrays for these hooks, gated by `isSupabaseConfigured()` like the Earnings page.

**Tech Stack:** Next.js 16 / React 19, Supabase Postgres + `@supabase/ssr`, plpgsql RPCs, Tailwind 4, lucide-react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-payout-accounts-history-design.md`
- No test framework for this layer — verification is `npx tsc --noEmit`, `npm run build`, `npm run lint`, and live verification via Supabase against the demo host account (this repo's established pattern — see AGENTS.md's "E2E test pattern").
- **RLS is non-negotiable**: every new table gets `alter table ... enable row level security` in the same migration that creates it (per AGENTS.md's critical grant-audit finding — this Supabase project silently grants broad write access outside RLS).
- Money fields are integers (₱, no decimals), matching `bookings.rental_fee` etc.
- `payout_accounts`/`payout_requests`/`payout_items` get **no** insert/update/delete grant to `authenticated` — all writes go through the RPCs in Task 1. Only `select`, RLS-scoped to the owning user.
- Primary color `#003049`; currency format `₱X,XXX`; existing dashboard card styling (`bg-white rounded-2xl border border-gray-100`) is the visual baseline — match `src/app/(main)/dashboard/payouts/page.tsx`'s current look, don't redesign it.
- Commit per task, imperative subjects, commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Migration — payout schema and RPCs

**Files:**
- Create: `supabase/migrations/020_payout_accounts.sql`

**Interfaces:**
- Produces: tables `public.payout_accounts`, `public.payout_requests`, `public.payout_items`; RPCs `set_payout_account(p_method payout_method, p_account_number text, p_account_name text)`, `request_payout()`, `review_payout_account(p_account_id uuid, p_approve boolean, p_notes text)`, `mark_payout_paid(p_request_id uuid, p_reference text)`, `mark_payout_failed(p_request_id uuid, p_notes text)`. Task 3/4 hooks call `set_payout_account` and `request_payout` via `supabase.rpc(...)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/020_payout_accounts.sql`:

```sql
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
```

- [ ] **Step 2: Push the migration to the hosted project**

Run: `supabase db push --linked --yes`
Expected: output ends with the migration applying cleanly (ignore pg-delta cert noise, per AGENTS.md). Then confirm:

Run: `supabase migration list --linked`
Expected: JSON includes `{"local":"020","remote":"020",...}` alongside 001–019.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/020_payout_accounts.sql
git commit -m "$(cat <<'EOF'
Add payout accounts, requests, and payout RPCs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: TypeScript types

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `PayoutAccount`, `PayoutItem`, `PayoutRequest` types. Task 3 uses `PayoutAccount`; Task 4 uses `PayoutItem`/`PayoutRequest`.

- [ ] **Step 1: Add the types**

In `src/types/index.ts`, immediately after the `VerificationRequest` interface (after the line `}` that closes it, before `export interface Notification`), add:

```typescript
export interface PayoutAccount {
  id: string
  user_id: string
  method: 'GCash' | 'Maya' | 'Bank Transfer (Instapay)' | 'BDO' | 'BPI' | 'UnionBank'
  account_number: string
  account_name: string
  status: 'pending' | 'verified' | 'rejected'
  reviewer_notes: string | null
  created_at: string
  reviewed_at: string | null
}

export interface PayoutItem {
  payout_request_id: string
  booking_id: string
  amount: number
}

export interface PayoutRequest {
  id: string
  host_id: string
  payout_account_id: string
  amount: number
  status: 'pending' | 'paid' | 'failed'
  reference: string | null
  notes: string | null
  requested_at: string
  processed_at: string | null
  items?: PayoutItem[]
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors (the file has no other consumers yet, so this just confirms the syntax is valid).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "$(cat <<'EOF'
Add PayoutAccount/PayoutRequest/PayoutItem types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `usePayoutAccount` hook

**Files:**
- Create: `src/hooks/usePayoutAccount.ts`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/client`, `isSupabaseConfigured()` from `@/lib/supabase/config`, `PayoutAccount` from `@/types` (Task 2). RPC `set_payout_account(p_method, p_account_number, p_account_name)` from Task 1.
- Produces: `usePayoutAccount()` returning `{ account: PayoutAccount | null, loading: boolean, setPayoutAccount(input: { method: PayoutAccount['method']; accountNumber: string; accountName: string }): Promise<string | null>, reload(): Promise<void> }`. Task 5 (page) consumes this.

- [ ] **Step 1: Create the hook**

Create `src/hooks/usePayoutAccount.ts`:

```typescript
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { PayoutAccount } from '@/types'

export function usePayoutAccount() {
  const [account, setAccountState] = useState<PayoutAccount | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setAccountState(null)
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAccountState(null)
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('payout_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!error) setAccountState(data as PayoutAccount | null)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function setPayoutAccount(input: { method: PayoutAccount['method']; accountNumber: string; accountName: string }) {
    const supabase = createClient()
    const { error } = await supabase.rpc('set_payout_account', {
      p_method: input.method,
      p_account_number: input.accountNumber,
      p_account_name: input.accountName,
    })
    if (error) return error.message
    await reload()
    return null
  }

  return { account, loading, setPayoutAccount, reload }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePayoutAccount.ts
git commit -m "$(cat <<'EOF'
Add usePayoutAccount hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `usePayoutRequests` hook

**Files:**
- Create: `src/hooks/usePayoutRequests.ts`

**Interfaces:**
- Consumes: `useHostBookings()` from `@/hooks/useBookings` (returns `{ bookings: BookingWithRefs[], loading: boolean, reload(): Promise<void> }`, where `BookingWithRefs` has `id`, `status`, `payment_status`, `rental_fee`). `createClient()`, `isSupabaseConfigured()`. `PayoutRequest`/`PayoutItem` from `@/types` (Task 2). RPC `request_payout()` from Task 1.
- Produces: `usePayoutRequests()` returning `{ requests: PayoutRequest[], loading: boolean, availableBalance: number, pendingPayout: number, hasPendingRequest: boolean, requestPayout(): Promise<string | null>, reload(): Promise<void> }`. Task 5 (page) consumes this.

- [ ] **Step 1: Create the hook**

Create `src/hooks/usePayoutRequests.ts`:

```typescript
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { useHostBookings } from './useBookings'
import type { PayoutRequest } from '@/types'

export function usePayoutRequests() {
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [loading, setLoading] = useState(true)
  const { bookings, loading: bookingsLoading, reload: reloadBookings } = useHostBookings()

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setRequests([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setRequests([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('payout_requests')
      .select('*, items:payout_items(*)')
      .eq('host_id', user.id)
      .order('requested_at', { ascending: false })
    if (!error) setRequests((data ?? []) as unknown as PayoutRequest[])
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const claimedBookingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of requests) {
      if (r.status === 'pending' || r.status === 'paid') {
        for (const item of r.items ?? []) ids.add(item.booking_id)
      }
    }
    return ids
  }, [requests])

  const availableBalance = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'completed' && b.payment_status === 'paid' && !claimedBookingIds.has(b.id))
        .reduce((sum, b) => sum + b.rental_fee, 0),
    [bookings, claimedBookingIds]
  )

  const pendingPayout = useMemo(
    () =>
      bookings
        .filter((b) => b.status === 'confirmed' || b.status === 'active')
        .reduce((sum, b) => sum + b.rental_fee, 0),
    [bookings]
  )

  const hasPendingRequest = requests.some((r) => r.status === 'pending')

  async function requestPayout() {
    const supabase = createClient()
    const { error } = await supabase.rpc('request_payout')
    if (error) return error.message
    await Promise.all([reload(), reloadBookings()])
    return null
  }

  return {
    requests,
    loading: loading || bookingsLoading,
    availableBalance,
    pendingPayout,
    hasPendingRequest,
    requestPayout,
    reload,
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePayoutRequests.ts
git commit -m "$(cat <<'EOF'
Add usePayoutRequests hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire the Payouts page to live data

**Files:**
- Modify: `src/app/(main)/dashboard/payouts/page.tsx`

**Interfaces:**
- Consumes: `usePayoutAccount()` (Task 3), `usePayoutRequests()` (Task 4), `isSupabaseConfigured()` from `@/lib/supabase/config`.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/app/(main)/dashboard/payouts/page.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { Landmark, Plus, CheckCircle2, Clock, AlertCircle, XCircle, Loader2 } from 'lucide-react'
import { usePayoutAccount } from '@/hooks/usePayoutAccount'
import { usePayoutRequests } from '@/hooks/usePayoutRequests'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { PayoutAccount } from '@/types'

const PAYOUT_METHODS: PayoutAccount['method'][] = [
  'GCash', 'Maya', 'Bank Transfer (Instapay)', 'BDO', 'BPI', 'UnionBank',
]

const MOCK_ACCOUNT: PayoutAccount = {
  id: 'p1', user_id: 'mock', method: 'GCash', account_number: '09171234567',
  account_name: 'Juan P. Tayco', status: 'verified', reviewer_notes: null,
  created_at: '2026-06-01', reviewed_at: '2026-06-02',
}

const MOCK_BALANCE = 32250

function mask(number: string) {
  return `•••• ${number.slice(-4)}`
}

const fmt = (n: number) => `₱${n.toLocaleString('en-PH')}`

function StatusPill({ status }: { status: PayoutAccount['status'] }) {
  if (status === 'verified') {
    return (
      <span className="text-xs bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" /> Verified
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
        <XCircle className="w-3 h-3" /> Rejected
      </span>
    )
  }
  return (
    <span className="text-xs bg-yellow-100 text-yellow-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
      <Clock className="w-3 h-3" /> Under review
    </span>
  )
}

export default function PayoutsPage() {
  const live = isSupabaseConfigured()
  const { account, loading: accountLoading, setPayoutAccount } = usePayoutAccount()
  const { requests, loading: requestsLoading, availableBalance, hasPendingRequest, requestPayout } = usePayoutRequests()

  const [formOpen, setFormOpen] = useState(false)
  const [method, setMethod] = useState<PayoutAccount['method'] | ''>('')
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [accountError, setAccountError] = useState<string | null>(null)
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const displayAccount = live ? account : MOCK_ACCOUNT
  const displayBalance = live ? availableBalance : MOCK_BALANCE
  const displayRequests = live ? requests : []
  const loading = live && (accountLoading || requestsLoading)

  async function handleAdd() {
    if (!method || !number || !name) return
    setSubmitting(true)
    setAccountError(null)
    const err = await setPayoutAccount({ method, accountNumber: number, accountName: name })
    setSubmitting(false)
    if (err) {
      setAccountError(err)
      return
    }
    setFormOpen(false)
    setMethod('')
    setNumber('')
    setName('')
  }

  async function handleRequestPayout() {
    setPayoutError(null)
    const err = await requestPayout()
    if (err) setPayoutError(err)
  }

  const canRequestPayout =
    live && !hasPendingRequest && displayAccount?.status === 'verified' && displayBalance > 0

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111827]">Payouts</h1>
        <p className="text-gray-500 text-sm mt-1">Manage where you receive your earnings</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-300">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <>
          {/* Payout balance */}
          <div className="bg-gradient-to-br from-[#003049] to-blue-700 rounded-2xl p-6 text-white">
            <p className="text-sm font-medium opacity-80">Available for payout</p>
            <p className="text-4xl font-bold mt-1">{fmt(displayBalance)}</p>
            <p className="text-sm opacity-70 mt-1">Processes within 1–2 business days</p>
            {live && hasPendingRequest ? (
              <p className="mt-4 text-sm font-semibold bg-white/10 inline-block px-4 py-2 rounded-xl">
                Payout requested — processing
              </p>
            ) : (
              <button
                onClick={handleRequestPayout}
                disabled={!canRequestPayout}
                className="mt-4 bg-white text-[#003049] font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Request Payout
              </button>
            )}
            {payoutError && <p className="mt-2 text-sm text-red-100">{payoutError}</p>}
          </div>

          {/* Payout account */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-bold text-[#111827]">Payout Account</p>
              {!formOpen && (
                <button onClick={() => setFormOpen(true)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#003049] hover:text-blue-700 transition-colors">
                  <Plus className="w-4 h-4" /> {displayAccount ? 'Replace account' : 'Add account'}
                </button>
              )}
            </div>

            {displayAccount && (
              <div className="flex items-center gap-4 p-4 bg-[#F8FAFC] rounded-xl border border-gray-100">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <Landmark className="w-5 h-5 text-[#003049]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-[#111827]">{displayAccount.method} {mask(displayAccount.account_number)}</p>
                  <p className="text-xs text-gray-400">{displayAccount.account_name}</p>
                  {displayAccount.status === 'rejected' && displayAccount.reviewer_notes && (
                    <p className="text-xs text-red-500 mt-1">{displayAccount.reviewer_notes}</p>
                  )}
                </div>
                <StatusPill status={displayAccount.status} />
              </div>
            )}

            {/* Add/replace account form */}
            {formOpen && (
              <div className="border border-[#003049]/30 rounded-xl p-5 space-y-4 bg-blue-50/30">
                <p className="font-bold text-sm text-[#111827]">{displayAccount ? 'Replace' : 'Add'} Payout Account</p>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Payment Method</label>
                  <select value={method} onChange={e => setMethod(e.target.value as PayoutAccount['method'])}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#003049] bg-white">
                    <option value="">Select method</option>
                    {PAYOUT_METHODS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Mobile Number / Account Number</label>
                  <input value={number} onChange={e => setNumber(e.target.value)}
                    placeholder="e.g. 09171234567"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#003049] bg-white" />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Account Name</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="Name as registered"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#003049] bg-white" />
                </div>

                {accountError && <p className="text-sm text-red-600">{accountError}</p>}

                <div className="flex gap-2">
                  <button onClick={() => { setFormOpen(false); setAccountError(null) }}
                    className="flex-1 border border-gray-200 rounded-xl py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleAdd} disabled={!method || !number || !name || submitting}
                    className="flex-1 bg-[#003049] text-white rounded-xl py-3 text-sm font-bold hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors">
                    {submitting ? 'Saving…' : (displayAccount ? 'Replace Account' : 'Add Account')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-gray-400 pt-1">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              New accounts go through a 24-hour verification before they can receive payouts.
            </div>
          </div>

          {/* Payout history */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <p className="font-bold text-[#111827] mb-4">Payout History</p>
            {live && displayRequests.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No payouts yet.</p>
            ) : (
              <div className="space-y-3">
                {displayRequests.map(req => (
                  <div key={req.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      req.status === 'paid' ? 'bg-green-50' : req.status === 'failed' ? 'bg-red-50' : 'bg-yellow-50'
                    }`}>
                      {req.status === 'paid' ? (
                        <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                      ) : req.status === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-yellow-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[#111827]">{fmt(req.amount)}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(req.requested_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                        {req.reference ? ` · ${req.reference}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold ${
                      req.status === 'paid' ? 'text-green-600' : req.status === 'failed' ? 'text-red-500' : 'text-yellow-600'
                    }`}>
                      {req.status === 'paid' ? 'Completed' : req.status === 'failed' ? 'Failed' : 'Processing'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build and lint**

Run: `npm run build 2>&1 | tail -5 && npm run lint 2>&1 | grep -c "error"`
Expected: build compiles clean; lint error count unchanged from the repo's pre-existing baseline (44) — no NEW errors in this file.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(main)/dashboard/payouts/page.tsx"
git commit -m "$(cat <<'EOF'
Wire Payouts page to real payout accounts and history

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Live verification and docs

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Live verification against the demo host account**

There is no completed+paid booking for the demo host (`demo@demo.rentivo.ph`) in seed data today, so this step temporarily flips one existing booking to `completed`/`paid` via the service-role admin client (which bypasses `enforce_booking_transition` — see `supabase/migrations/004_security_hardening.sql:74-78`, `if auth.uid() is null then return new;`), runs the full flow, then reverts it.

From the project root, with `.env.local` present, run this script (delete it afterward — it's a one-off verification script, not part of the app):

```javascript
// scratchpad-verify-payouts.js
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY)

const TEST_BOOKING_ID = '4669dc99-9720-4920-9900-be8213b96c7f' // demo host, currently cancelled/paid, rental_fee 1200

async function main() {
  // 1. Flip the test booking to completed so it has an eligible balance
  const { data: original } = await admin.from('bookings').select('status').eq('id', TEST_BOOKING_ID).single()
  await admin.from('bookings').update({ status: 'completed' }).eq('id', TEST_BOOKING_ID)

  // 2. Sign in as the demo host (RLS-scoped client, matching AGENTS.md's e2e pattern)
  const asHost = createClient(url, anonKey)
  const { data: signIn, error: signInError } = await asHost.auth.signInWithPassword({
    email: 'demo@demo.rentivo.ph',
    password: 'DemoRentivo1',
  })
  if (signInError) throw signInError
  console.log('signed in as', signIn.user.id)

  // 3. Add a payout account as the host
  const { data: acct, error: acctErr } = await asHost.rpc('set_payout_account', {
    p_method: 'GCash',
    p_account_number: '09171234567',
    p_account_name: 'Demo Host',
  })
  console.log('set_payout_account ->', acct, acctErr)

  // 4. Confirm request_payout fails before verification
  const { error: tooEarly } = await asHost.rpc('request_payout')
  console.log('request_payout before verify (expect error) ->', tooEarly?.message)

  // 5. Admin verifies the account
  const { data: verified, error: verifyErr } = await admin.rpc('review_payout_account', {
    p_account_id: acct.id,
    p_approve: true,
    p_notes: null,
  })
  console.log('review_payout_account ->', verified, verifyErr)

  // 6. Host requests a payout
  const { data: req, error: reqErr } = await asHost.rpc('request_payout')
  console.log('request_payout ->', req, reqErr)

  // 7. Confirm a second request is blocked while pending
  const { error: dupeErr } = await asHost.rpc('request_payout')
  console.log('request_payout while pending (expect error) ->', dupeErr?.message)

  // 8. Confirm payout_items are itemized correctly
  const { data: items } = await admin.from('payout_items').select('*').eq('payout_request_id', req.id)
  console.log('payout_items ->', items)

  // 9. Admin marks it paid
  const { data: paid, error: paidErr } = await admin.rpc('mark_payout_paid', {
    p_request_id: req.id,
    p_reference: 'TEST-REF-001',
  })
  console.log('mark_payout_paid ->', paid, paidErr)

  // 10. Confirm a second host cannot read the first host's rows (RLS check)
  const { data: renterSignIn } = await asHost.auth.signOut()
  const asRenter = createClient(url, anonKey)
  await asRenter.auth.signInWithPassword({ email: 'renter@demo.rentivo.ph', password: 'DemoRentivo1' })
  const { data: leaked } = await asRenter.from('payout_accounts').select('*').eq('id', acct.id)
  console.log('renter reading host payout_account (expect empty array) ->', leaked)

  // 11. Cleanup — revert the test booking and remove test rows
  await admin.from('payout_items').delete().eq('payout_request_id', req.id)
  await admin.from('payout_requests').delete().eq('id', req.id)
  await admin.from('payout_accounts').delete().eq('id', acct.id)
  await admin.from('bookings').update({ status: original.status }).eq('id', TEST_BOOKING_ID)
  console.log('cleanup done')
}

main().catch((err) => { console.error(err); process.exit(1) })
```

Run: `node scratchpad-verify-payouts.js`

Expected:
- Step 4 (`request_payout` before verify) errors with "You need a verified payout account before requesting a payout."
- Step 6 (`request_payout` after verify) succeeds, `req.amount === 1200`.
- Step 7 (second request while pending) errors with "You already have a payout request in progress."
- Step 8 shows exactly one `payout_items` row for `TEST_BOOKING_ID` with `amount: 1200`.
- Step 9 succeeds, `paid.status === 'paid'`.
- Step 10 (`leaked`) is an empty array — confirms RLS blocks cross-user reads.
- Step 11 completes without error, restoring the booking's original status.

Then delete the script: `rm scratchpad-verify-payouts.js`

Also do a quick manual pass with `npm run dev` running, logged in as `demo@demo.rentivo.ph`, on `http://localhost:3000/dashboard/payouts`: confirm the page loads without a payout account (empty state, no "Under review" card), the add-account form works, and after running `review_payout_account` for that real account via the SQL editor, "Request Payout" becomes enabled.

- [ ] **Step 2: Update AGENTS.md**

In the "To Do" → "Deferred — needs a product decision, not just wiring" section, remove the line:
```
- [ ] Payout accounts/history (dashboard/payouts is still mock — no schema for storing bank/e-wallet payout methods; this touches real money movement so needs a deliberate design, not a quick migration)
```

In the "Status — Done" list, add (after the search results map view line):
```
- [x] Payout accounts/history (020): hosts store one payout account (`payout_accounts`, written only via `set_payout_account()`), request payouts against completed+paid bookings not yet claimed by a pending/paid request (`request_payout()`, itemized per-booking in `payout_items`), and see real history on `/dashboard/payouts`. Actual money movement stays manual — an admin verifies accounts and marks requests paid/failed via SQL-editor RPCs (`review_payout_account`, `mark_payout_paid`, `mark_payout_failed`), mirroring the identity-verification pattern; no live disbursement API. Verified live against the demo host account: account add → blocked payout request → admin verify → successful itemized request → blocked duplicate request → admin mark-paid → cross-user RLS read blocked.
```

Append to the "Architecture Notes" security-model paragraph area (as its own new bullet, after the pickup-map/search-map note), a new sentence describing the pattern for future agents:

```
- **Payouts**: `payout_accounts` (one per host, replace-not-append) / `payout_requests` / `payout_items` (020) — same manual-admin-review shape as identity verification: hosts write only through `set_payout_account()`/`request_payout()` (security-definer RPCs scoped to `auth.uid()`), and every status transition (`verified`/`rejected`/`paid`/`failed`) is a `service_role`-only RPC run manually from the SQL editor. `request_payout()` itemizes exactly which completed+paid bookings a request covers into `payout_items`, so a booking can never be claimed by two payout requests at once, and a failed request's bookings automatically become eligible again. No live PayMongo disbursement — money movement itself is manual, matching this project's existing "verify live, no automated bank transfer" posture.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
Wire payout accounts and history end-to-end

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
