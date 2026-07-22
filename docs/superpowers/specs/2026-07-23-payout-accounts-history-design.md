# Payout Accounts & History — Design

**Date:** 2026-07-23
**Status:** Approved

## Goal

Replace the fully-mocked `/dashboard/payouts` page with a real data model: hosts store one payout account (GCash/Maya/bank), see their actual available balance, request a payout against it, and see real payout history. Actual money movement stays manual/admin-run — no live disbursement API integration.

## Decisions (made with user)

- **Payout execution:** manual, admin-run. Mirrors the identity-verification pattern already in the app — hosts request/manage in-app, an admin fulfills the transfer out-of-band and marks it paid via a service-role RPC. No PayMongo disbursement API (it needs a verified business account this project doesn't have, and would be a second money-movement integration alongside checkout/refunds).
- **Trigger:** host-initiated. Host clicks "Request Payout"; no scheduled/cron job (none exists in this repo).
- **Scope of a request:** itemized by booking, not lump-sum. A `payout_items` join table records exactly which completed bookings a request covers.
- **PII handling:** store the full account number (the admin needs it to actually send money); the UI only ever displays a masked version. RLS scopes reads to the owning user; no admin UI exists to browse these, only manual SQL-editor access as `service_role`.
- **Multiple accounts:** one active account per host. Adding a new one replaces the old (`unique(user_id)`), no default-selection UI needed.
- **Verification gate:** real, not cosmetic. New/replaced accounts start `pending`; Request Payout is blocked until an admin flips it to `verified` — same shape as `review_verification_request`.

## Data model

New migration `020_payout_accounts.sql`, following the `verification_requests` (015) and `mark_booking_refunded` (014) patterns.

```sql
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

create table public.payout_items (
  payout_request_id uuid not null references public.payout_requests(id) on delete cascade,
  booking_id         uuid not null references public.bookings(id),
  amount             integer not null,
  primary key (payout_request_id, booking_id)
);
```

`alter table ... enable row level security` is applied to all three new tables in this same migration (non-negotiable per the project's grant-audit finding — see AGENTS.md security note).

**Eligibility rule** (used both server-side in `request_payout()` and client-side for display): a booking counts toward available balance if `status = 'completed' and payment_status = 'paid'`, and its `id` is not already present in `payout_items` for any request with `status in ('pending', 'paid')`. A `failed` request's bookings automatically become eligible again — no extra bookkeeping.

## RPCs & security

**`set_payout_account(p_method, p_account_number, p_account_name)`**
Security definer, `authenticated` execute. Upserts on `(user_id)` using `auth.uid()` internally (never a passed-in id), always resetting `status='pending'`, `reviewed_at=null`, `reviewer_notes=null`. This is the *only* write path to `payout_accounts` — `authenticated` is granted `select` only, no `insert`/`update`, so a host can never self-approve (same "no self-granting" pattern as `profiles.is_verified`).

**`request_payout()`**
Security definer, `authenticated` execute, operates only on `auth.uid()`:
1. Requires the caller's `payout_accounts.status = 'verified'`, else raise.
2. Raises if a `pending` request already exists (belt-and-suspenders alongside the partial unique index).
3. Computes eligible bookings per the rule above; raises "No available balance" if the sum is 0.
4. Inserts one `payout_requests` row (`status='pending'`) plus one `payout_items` row per eligible booking, snapshotting `rental_fee` as `amount`.
5. Returns the new request.

**Admin-only, `service_role`, run manually via SQL editor** (no admin UI — matches `review_verification_request`):
- `review_payout_account(account_id, approve, notes)` — `pending → verified/rejected`.
- `mark_payout_paid(request_id, reference)` — idempotent, `pending → paid`, sets `processed_at`.
- `mark_payout_failed(request_id, notes)` — idempotent, `pending → failed`.

`payout_requests`/`payout_items` grant `select` only to `authenticated` (RLS: `host_id = auth.uid()`, and items scoped via a subquery on their parent request); all writes go through the RPCs above.

## Client hooks & UI

**`src/hooks/usePayoutAccount.ts`** — fetches the caller's `payout_accounts` row (or `null`); exposes `setAccount({ method, accountNumber, accountName })` calling the RPC. The UI masks the number client-side (`•••• 1234`, last 4 digits) — the raw value only ever leaves the DB via manual `service_role` SQL.

**`src/hooks/usePayoutRequests.ts`** — fetches the caller's `payout_requests` (RLS-scoped) with nested `payout_items`, plus completed+paid bookings (reuses the `useHostBookings` query shape). Derives, client-side, for display only (server RPC remains authoritative):
- `availableBalance` — sum of eligible bookings' `rental_fee`
- `pendingPayout` — sum of `confirmed`/`active` bookings' `rental_fee` (unchanged from Earnings today)
- `history` — `payout_requests`, newest first

Exposes `requestPayout()`, which calls the RPC and refetches.

**`src/app/(main)/dashboard/payouts/page.tsx`** — replace the hardcoded `PAYOUT_ACCOUNTS`/`PAYOUT_HISTORY` arrays with the two hooks above, gated by `isSupabaseConfigured()` the same way Earnings is (falls back to today's mock arrays when unconfigured). Behavior changes:
- Payout account card shows the real `status` (`pending`/`verified`/`rejected`) instead of a static "Default" pill; `rejected` surfaces `reviewer_notes` if present.
- "Request Payout": disabled when `availableBalance === 0`, no verified account, or a `pending` request already exists (shows "Payout requested — processing" in that case).
- Add-account form calls `setAccount()`; success shows the new row as `pending`, no more local-only `added` state.
- History list renders real `payout_requests` (amount, `requested_at`, `status`, `reference` when paid) instead of the static array.

## Error handling

RPC exceptions (no verified account, already-pending request, zero balance) surface as inline error text near the Request Payout button — same convention already used for the booking respond/cancel flows in the dashboard.

## Testing

No automated test suite covers this layer today; the project's established pattern is live/manual verification (see refunds, identity verification in AGENTS.md). Plan:
1. `npm run build` + `npm run lint`.
2. Against the demo host account: add a payout account (lands `pending`) → manually run `review_payout_account(..., true, ...)` in the SQL editor → confirm Request Payout becomes enabled → request a payout → confirm it's itemized correctly against completed+paid bookings → manually run `mark_payout_paid(...)` → confirm history reflects `paid` and the balance no longer double-counts those bookings.
3. Confirm RLS: a second account cannot read/write the first host's `payout_accounts`/`payout_requests` rows directly.

## Out of scope

Real bank/e-wallet integration, admin UI (SQL editor only), scheduled/automatic payouts, minimum payout threshold.
