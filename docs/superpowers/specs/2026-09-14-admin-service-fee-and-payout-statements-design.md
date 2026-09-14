# Admin-controlled service fee and admin-issued payout statements — design

**Date:** 2026-09-14
**Status:** approved roadmap, design decisions taken under the owner's standing autonomy; not yet implemented
**Phases B and C of three** (A: retire host-QR and billing — built; B: this document §2–§5; C: §6–§11)

The owner's instruction, verbatim: *"we as admin can control the transaction fee and send to host
their income and also we have to make an invoice for that"*. Their answers to the design questions
are binding and recorded in §1. Everything marked **Decision** below was an open question the owner
delegated; each records the alternative and why it lost.

Phase B ships on its own and first. Phase C ships on its own after B (it snapshots the per-booking
rate B introduces; nothing else in C depends on B).

---

## 1. Binding decisions (the owner's)

- **B — one platform-wide service-fee rate**, set by the admin in the admin panel. Not per host, not
  per category. **Each booking stores the rate it was charged at**, so a later change never alters a
  past booking's receipt or payout.
- **C — the admin pays hosts out; no host request.** The admin sees what each host is owed and records
  a payout. The host gets a **numbered payout statement** listing the bookings covered, the gross
  amount, Rentivo's service fee, delivery fees and the net paid. The statement is printable, emailed to
  the host, and visible on `/dashboard/payouts`.

## 2. Live state this is built on (verified 2026-09-14, not taken from the brief)

| Thing | State |
|---|---|
| `create_booking` | one overload, 10 args (078); `service_fee_rate constant numeric := 0.05`; ACL `postgres, authenticated, service_role` = EXECUTE |
| Who pays the service fee | **The renter, on top.** `total_amount = v_rental + v_service + v_protection + v_delivery`; the host is paid `rental_fee + delivery_fee` (`request_payout`, 038). Nothing is deducted from the host. |
| `bookings` | 19 rows. `service_fee` matches 5% on 6, 12% (pre-035) on 13, both on 0, neither on 0. 0 paid bookings carry a promo `discount`. 4 completed+paid bookings carry a pre-035 `protection_fee`. |
| `bookings` grants | table-level `SELECT, DELETE` to anon/authenticated; `UPDATE (status, host_notes, renter_notes)` only (040). A new column is readable under the existing RLS with no new grant, and not client-writable. |
| `payout_requests` | 1 row: `paid`, ₱1,200, reference `QA-GCASH-REF-001`, demo host (`a0…ff`), requested and processed 2026-09-01. 0 pending, 0 failed. |
| `payout_items` | 1 row. PK `(payout_request_id, booking_id)` — **no constraint stops a booking appearing in two requests**; only `request_payout`'s CTE does. |
| `payout_requests` index | `payout_requests_one_pending_per_host` — unique `(host_id) where status = 'pending'` |
| `payout_status` enum | `pending, paid, failed` |
| payout tables' grants | **table-level INSERT/SELECT/UPDATE/DELETE to anon and authenticated** (bootstrap blanket grant); RLS has SELECT-own policies only, so writes are denied by RLS default-deny, not by privilege |
| `request_payout` / `set_payout_account` | `authenticated`; `mark_payout_paid` / `mark_payout_failed` / `review_payout_account`: `service_role` only |
| `set_payout_account` | `on conflict (user_id) do update … status = 'pending'` — replacing an account rewrites the row a pending request points at and sends it back to review |
| `admin_actions` | 1 row; `target_user_id uuid NOT NULL`; RLS on, no policies |
| Default privileges | migration 079 (written, **not yet applied** at authoring) revokes `postgres`'s default table `arwd` from anon/authenticated. Function defaults still grant `EXECUTE` to anon/authenticated/PUBLIC, so **every new function must revoke explicitly**. |
| `/admin/payouts` | shows the *current* `payout_accounts` row joined through `payout_account_id`, not what it was when the request was made (the 048 redirection problem, visible in the UI) |
| `usePayoutRequests().availableBalance` | sums `rental_fee` only — omits delivery fees, the `host_qr`/`test_skip` exclusions and 077's return-date rule. **Already wrong** today. |
| Host pricing copy | `Step3Pricing.tsx` shows "Rentivo service fee (5%) −₱X … You receive ₱0.95×"; the listing edit page says "You earn ₱0.95× per day after the 5% fee". **Both false**: the host receives 100% of the rate. `/host-terms` says the fee is "deducted from the payment", which reads the same wrong way. |

## 3. Phase B — data model

### 3.1 The setting

```sql
create table public.platform_settings (
  id              boolean primary key default true check (id),
  service_fee_bps integer not null check (service_fee_bps between 0 and 2000),
  updated_at      timestamptz not null default now()
);
```

A single-row table (the `check (id)` on a boolean PK makes a second row impossible). RLS enabled in
the creating migration with **no policies and all client privileges revoked** — clients read the rate
only through `current_service_fee_bps()`.

**Decision — basis points (integer), not a numeric percentage.** `500` = 5.00%. The client mirror is
then pure integer arithmetic (§4.3) and the admin form can never round-trip a float. Resolution of
0.01% is finer than any sensible fee change.

**Decision — cap at 2000 bps (20%).** The cap is a typo guard, not a business limit: the likeliest
mistake is typing `50` for 5.0%. Raising it is a one-line migration.

**Decision — the change is immediate, not scheduled.** A scheduled `effective_at` adds a second clock to
reason about in `create_booking` and a cron-free activation problem; the stored per-booking rate
already makes history exact. The admin picks the moment.

### 3.2 Per-booking rate

```sql
alter table public.bookings
  add column service_fee_bps integer check (service_fee_bps between 0 and 2000);
```

Written only by `create_booking`. Readable by the booking's two parties through the existing table-level
SELECT + RLS; not writable (040's UPDATE column list does not include it).

**Backfill:** `500` where `service_fee = round(rental_fee × 0.05)` and not the 12% figure, `1200` where
the reverse, `null` where both match (only possible at tiny rentals; 0 rows today). The migration
**aborts** if any row matches neither — that would mean a fee history nobody has explained, and a guessed
rate on a receipt is worse than stopping. `null` renders as "Service fee" with no percentage.

### 3.3 RPCs

| Function | Kind | Grant | Behaviour |
|---|---|---|---|
| `current_service_fee_bps() returns integer` | plpgsql, stable, security definer | anon, authenticated, service_role | Returns the rate. **Raises** if the settings row is missing, so `create_booking` fails closed rather than charging at an unknown rate. |
| `set_service_fee_bps(p_bps integer, p_reason text, p_admin_email text) returns table(previous_bps integer, service_fee_bps integer)` | plpgsql, security definer | service_role only | Locks the row, validates range, refuses a no-op and a blank reason, updates, and writes the `admin_actions` row **in the same transaction**. |

**Decision — the audit row is written inside the RPC, not by the route.** Existing admin routes insert
`admin_actions` after the RPC returns, which can leave a money change unaudited if the second call
fails. For a change that sets the price every renter pays, the change and its audit commit together or
not at all. `admin_actions.target_user_id` becomes nullable (a platform setting has no target user);
the index and every existing reader filter by a concrete id, so nothing reads a null.

## 4. Phase B — charging and displaying the rate

### 4.1 `create_booking`

This function has caused three incidents here (038/039, 040, and 073's production break under a green
suite). The rewrite therefore:

1. is its **own migration** (081), separate from the table work (080), so its verification is focused;
2. **copies the live body from `pg_get_functiondef`**, never from a migration file;
3. uses `CREATE OR REPLACE` with the **unchanged signature and return type** — which keeps the existing
   ACL, so no grant is re-issued (the 069/078 drop-recreate grant trap cannot happen);
4. carries a guard that aborts unless `md5(pg_get_functiondef(…))` equals the hash captured at authoring,
   so a concurrent edit to the function between authoring and apply stops the migration instead of
   being silently overwritten;
5. changes exactly four places:

```text
- service_fee_rate    constant numeric := 0.05;
+ -- 081: the admin-set platform rate (080). Read ONCE, so the fee charged and
+ -- the rate stamped on the row are the same value by construction.
+ v_fee_bps           constant integer := public.current_service_fee_bps();
+ service_fee_rate    constant numeric := v_fee_bps / 10000.0;

- -- 038: change 2 of 4 — mirrors the host_qr guard above. A NULL fee means
+ -- 038: change 2 of 4. A NULL fee means

-     delivery_distance_km, delivery_latitude, delivery_longitude
+     delivery_distance_km, delivery_latitude, delivery_longitude,
+     service_fee_bps

-     case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end
+     case when p_is_delivery and coalesce(v_listing.delivery_fee_per_km, 0) > 0 then p_delivery_lng end,
+     v_fee_bps
```

The comment fix is the one TODO.md reserved for "a future rewrite of that function, never a standalone
one"; this is that rewrite.

**Decision — the rate is read in `create_booking`, not stamped by a trigger.** A `before insert` trigger
would avoid touching the function, but it would read the setting in a *different statement* from the
one that computed the fee; under READ COMMITTED an admin change committing between the two would stamp
one rate on a fee computed at another. The rate must be read once and used twice.

`v_fee_bps / 10000.0` is exact in `numeric` (the denominator is a power of ten), so
`round(v_rental * service_fee_rate)` behaves exactly as it does today at `500`.

### 4.2 Rate-change semantics

- **The rate is fixed when the booking row is created**, not when it is paid. An unpaid booking created at
  5% that is paid after the admin moves to 7% is charged 5% — the PayMongo intent is priced from the
  stored `total_amount`, as it already is.
- **Mid-checkout change** (renter loaded the page at 5%; admin commits 7%; renter presses Pay):
  `create_booking` charges 7% and stores it; the checkout route sees `expectedTotal ≠ total_amount` and
  returns the existing **409 `total_changed`** with the stored amounts before any intent exists; the
  wizard adopts them (the summary's percentage label reads the stored `service_fee_bps`) and the renter
  pays the shown total on retry, reusing the same booking. No new code path — the 409 already exists for
  host rate changes (078) and this is the same shape.
- **Reused booking, rate lowered since:** reuse charges the stored (higher) total; the 409 shows it. The
  renter can reload for a fresh booking at the new rate; the abandoned one stays `pending`/`unpaid`, as
  abandoned bookings already do.
- **Payouts are unaffected by the rate.** The host is paid `rental_fee + delivery_fee`; a rate change moves
  only what the renter pays and what Rentivo keeps.
- **Refunds** keep refunding the stored `total_amount`, so a renter is refunded the fee they were charged.

### 4.3 Client mirror

`src/lib/pricing.ts`:

- `SERVICE_FEE_RATE` is **deleted** (not deprecated), so `tsc` finds every consumer.
- `calcPricing(listing, days, serviceFeeBps, isDelivery?, deliveryFeeOverride?)` — the rate is a required
  third positional parameter. Placing it before the boolean means every stale call site fails to
  type-check rather than silently compiling.
- `serviceFeeFor(rental, bps) = Math.floor((rental * bps + 5000) / 10000)` — integer arithmetic that equals
  Postgres `round(rental * (bps / 10000.0))` (half away from zero) for every non-negative integer pair.
  Proven against Postgres over a grid including every tie, not asserted.
- `formatFeeRate(bps)` → `"5%"`, `"7.5%"`, `"12.25%"`.
- `DEFAULT_SERVICE_FEE_BPS = 500` — **mock mode only**.
- `StoredBookingAmounts` gains `service_fee_bps: number | null`.

Where the rate comes from:

| Consumer | Source |
|---|---|
| `listings/[id]` page → `BookingPanel`; `book` page → `BookingWizard` → `OrderSummary`, `Step3Payment` | `getServiceFeeBps()` (`src/lib/service-fee.ts`, server-only) passed as a prop |
| `Step3Pricing` (wizard), listing edit page | `useServiceFeeBps()` hook |
| `/terms`, `/host-terms`, `/admin/reports` | `getServiceFeeBps()`; the two legal pages become `force-dynamic` so a change is never served from a static build |
| Receipt (`Step4Confirmation`) | the booking's stored `service_fee_bps` |

**Decision — a failed rate read in live mode falls back to `DEFAULT_SERVICE_FEE_BPS` and logs,** rather than
throwing the listing page into an error boundary. The number shown before payment is a display; the
409 is the backstop that stops a mismatched charge. In the hooks (host-facing copy only), a failed read
hides the percentage rather than showing a guess.

### 4.4 Copy corrected in the same phase

The rate becoming variable forces every "5%" string to be touched, and three of them are false today:

- **Wizard earnings preview and edit page:** "You receive ₱{daily} per day. Renters pay ₱{daily + fee}
  (your rate plus Rentivo's {rate} service fee, charged to the renter)." No deduction line.
- **`/host-terms`:** "Rentivo charges renters a service fee of {rate} of the rental fee, added on top of your
  price at checkout. It is not deducted from your earnings. Delivery fees are paid to you in full."
- **`/terms` §6:** the two "5%" sentences read the live rate and say the rate in effect when a booking is
  made is the rate charged for it.
- **`/admin/reports`:** "Commission is the service fee stamped on each booking (currently {rate})."

## 5. Phase B — admin UI

- **`/admin/settings`** (new; linked in the admin nav): current rate and when it last changed; a form taking
  a percentage with up to two decimals, a required reason, and a live preview ("On a ₱1,000 rental the
  renter pays ₱1,050 now, ₱1,075 after"); a `confirm()` naming both rates; a history table of every
  `service_fee_rate_change` row in `admin_actions`.
- **`POST /api/admin/settings/service-fee`** `{ bps: integer, reason: string }` → `requireAdminApi()` →
  `set_service_fee_bps` with the admin's email. 400 on non-integer/out-of-range/blank reason before the RPC;
  the RPC re-validates.
- The `/admin` overview gains a card showing the current rate.

---

## 6. Phase C — the model: evolve `payout_requests`, don't add a parallel ledger

**Decision — a `payout_requests` row *is* the statement.** Its lifecycle becomes:

| Status | Statement number | Meaning | Host sees |
|---|---|---|---|
| `pending` | none | **Draft**: the admin has fixed the bookings and amount; money not yet sent | "Being prepared — ₱X" |
| `paid` | `PS-YYYY-NNNNNN` | **Issued**: the admin recorded the transfer | statement, printable, emailed |
| `failed`, no number | none | **Cancelled draft** (admin cancelled before sending) | hidden |
| `failed`, number, `reversed_at` set | kept | **Reversed**: an issued transfer did not arrive / was recorded in error | statement stamped REVERSED |

A separate `payout_statements` table was rejected: the existing tables already itemize bookings per payout,
already carry the "one booking claimed once" rule, and are what `/admin/reports` and the earnings page read.
A second table would duplicate that rule — the drift this repo has paid for repeatedly. `payout_status`
keeps its three values; reversal is a column, not a fourth enum value, so no isolated enum migration is
needed and every existing `status = 'paid'` reader (reports' Payouts Paid) automatically stops counting a
reversed payout.

**Decision — the host's "Request Payout" button and `request_payout()` are removed.** The owner's model is
admin-initiated; keeping a host request path would give two ways to create a draft with different
snapshotting. The host keeps `set_payout_account` (the admin still needs a verified destination).

## 7. Phase C — data model

### 7.1 `payout_requests` additions

```sql
alter table public.payout_requests
  add column statement_number     text unique check (statement_number ~ '^PS-[0-9]{4}-[0-9]{6}$'),
  add column account_method       public.payout_method,
  add column account_name         text,
  add column account_number       text,
  add column transferred_on       date,
  add column reversed_at          timestamptz,
  add column reversal_reason      text,
  add column statement_emailed_at timestamptz;
```

**Decision — snapshot the payout account onto the draft.** `set_payout_account` rewrites the row a draft
points at (048). The statement must record where the money was actually sent, and the admin must transfer to
the details the draft fixed. The admin page compares the snapshot with the current account and warns when the
host has since replaced it ("Account changed since this draft — cancel and re-prepare unless you already sent
it"). **Issuing is not refused on a mismatch**: if the admin already transferred, refusing to record a real
transfer is worse than recording it (the `mark_booking_paid` reasoning in AGENTS.md).

Invariants, as `check` constraints added after backfill:

- `status <> 'paid' or (statement_number, reference, transferred_on, account_* all not null)`
- `status <> 'pending' or statement_number is null`
- `reversed_at is null or (status = 'failed' and statement_number is not null and reversal_reason is not null)`
- `statement_number is null or status = 'paid' or reversed_at is not null`

### 7.2 `payout_items` additions (per-booking snapshot)

```sql
alter table public.payout_items
  add column booking_ref     text,
  add column listing_title   text,
  add column pickup_date     date,
  add column return_date     date,
  add column rental_fee      integer,
  add column delivery_fee    integer,
  add column service_fee     integer,
  add column service_fee_bps integer;
```

Backfilled from `bookings`/`listings`, then `not null` on all but `service_fee_bps`, plus
`check (amount = rental_fee + delivery_fee)`. A statement is a document; it must not change when a host renames
a listing or an account is anonymized. No renter name is stored — the booking reference identifies the booking
without putting a counterparty's identity on the host's paper.

### 7.3 Statement numbering

```sql
create table public.payout_statement_counters (
  year        integer primary key check (year between 2026 and 2100),
  last_number integer not null check (last_number >= 0)
);
```

RLS enabled, no policies, all client privileges revoked.

**Decision — gapless per calendar year (Asia/Manila), assigned at issue, from a counter row — not a sequence.**
Format `PS-2026-000001`.

- A Postgres **sequence is not transactional**: a rolled-back issue burns a number, so a sequence cannot be
  gapless. A counter row incremented by `insert … on conflict (year) do update set last_number = last_number + 1
  returning` inside the issuing transaction is gapless by construction (a rollback undoes the increment), and its
  row lock serializes two concurrent issues.
- **Assigned at issue, not at draft**, so a cancelled draft never consumes a number. A reversed statement keeps
  its number; the series never skips and never reuses.
- **Per year** because that is how a bookkeeper files them; six digits is ample.
- The serialization point is one row per year, touched once per payout — negligible at this volume.
- **This is a payout statement (remittance advice), not a BIR invoice or official receipt.** The document says so
  in its footer. See §12.

### 7.4 Eligibility — one definition instead of three copies

Today eligibility lives in `request_payout`'s CTE, `getUnrequestedPayouts()` (TS mirror) and
`usePayoutRequests().availableBalance` (a third, wrong mirror). Phase C replaces all three with one SQL function:

```sql
public.payout_eligible_bookings(p_host_id uuid)   -- null = all hosts
  returns table (booking_id uuid, host_id uuid, payable integer)
```

Body is `request_payout`'s CTE predicate verbatim (`completed`, `paid`, `return_date <= Manila today`,
`payment_method is distinct from host_qr / test_skip`, not in a `pending`/`paid` item) plus the host filter.
**The `host_qr` and `test_skip` exclusions stay** (Phase A §4.2: paying `RNT-02A59F` out would pay its host twice).
It is internal: no client grant. Callers:

| Function | Grant | Returns |
|---|---|---|
| `payouts_owed(p_host_id uuid default null)` | service_role | `(host_id, bookings, amount)` per host — admin page, reports, account deletion |
| `my_payout_balance()` | authenticated | `(bookings, amount)` for `auth.uid()` — host payouts page |

### 7.5 Lifecycle RPCs (all `security definer`, `set search_path = public, pg_temp`, service_role only unless stated)

**`create_payout_statement(p_host_id uuid, p_expected_amount integer, p_admin_email text) returns payout_requests`**
1. `pg_advisory_xact_lock(hashtext('payout-statement:' || p_host_id))` — serializes two admins (or two clicks).
2. Refuse: unknown host; **suspended host** ("Payouts are on hold — reinstate the host first"); no *verified* payout
   account; an existing draft ("Record or cancel it first" — the unique index is the backstop).
3. Insert the draft (amount 0, account snapshot), insert items from `payout_eligible_bookings` joined to
   `bookings`/`listings`, **then** sum the inserted items. Refuse if the sum is 0, or if it differs from
   `p_expected_amount` ("The amount owed changed from ₱A to ₱B — reload and check"). Summing what was inserted, not a
   separate earlier read, means a booking completing concurrently cannot make the stored amount and the items
   disagree.
4. Set the amount; write `admin_actions` (`payout_statement_draft`, target host, detail
   `{payout_request_id, amount, bookings}`).

**`issue_payout_statement(p_request_id uuid, p_reference text, p_transferred_on date, p_admin_email text) returns payout_requests`**
1. Lock the row. Reference: trimmed, required, ≤ 100 chars.
2. **Idempotent:** already `paid` with the same reference → return it unchanged. `paid` with a different reference →
   refuse. Not `pending` → refuse.
3. `transferred_on` required, not after today (Manila), not before the draft's date.
4. Increment the counter for the current Manila year; set `status = 'paid'`, `statement_number`, `reference`,
   `transferred_on`, `processed_at = now()`.
5. Write `admin_actions` (`payout_statement_issue`).

A suspended host **does not block issuing** (the admin may already have sent the money); the admin page shows the
existing "Suspended — verify before paying" badge on the draft.

**`cancel_payout_statement(p_request_id uuid, p_reason text, p_admin_email text)`** — draft → `failed`, reason in
`notes` (required), `processed_at`. Idempotent on an already-cancelled draft. Refuses an issued statement ("reverse it
instead"). Releases the bookings (the eligibility predicate ignores `failed`). No email: the host never received
anything.

**`reverse_payout_statement(p_request_id uuid, p_reason text, p_admin_email text)`** — issued → `failed`,
`reversed_at`, `reversal_reason` (required); number kept. Idempotent on an already-reversed statement. Refuses a
draft ("cancel it instead"). Releases the bookings, so the host is owed again. The route requires the admin to type
the statement number to confirm, because releasing bookings of a transfer that *did* arrive would pay the host twice.

### 7.6 The old functions

- **082** redefines `request_payout`, `mark_payout_paid` and `mark_payout_failed` (CREATE OR REPLACE, grants kept) to
  raise *"Payouts now use statements — reload the page."* In the minutes between applying 082 and the app deploy, an
  old admin tab cannot issue a paid request without a statement number and an old host tab cannot create an
  un-snapshotted draft. Nothing breaks the invariants in the window.
- **083** drops all three once the new app is live.
- 082 also **revokes table-level INSERT, UPDATE, DELETE** on `payout_accounts`, `payout_requests`, `payout_items` from
  anon and authenticated. No client writes them (every writer is a definer RPC — re-checked by grep in the plan);
  today only RLS default-deny stops a write.

### 7.7 Migrating existing rows

Guarded at apply: abort unless the counts match what was measured at authoring (1 paid, 0 pending, 0 failed), so the
backfill never runs against a state nobody looked at.

- Items: snapshot columns from `bookings`/`listings`.
- Requests: account snapshot from the linked `payout_accounts` row (the only record there is; for the one legacy row it
  is the demo account); `transferred_on = processed_at::date` in Manila.
- Paid requests: numbered in `processed_at` order within their Manila year — the legacy row becomes **`PS-2026-000001`**;
  the counter is set to match.
- Any `pending` request that exists at apply time (0 today) stays a draft and is issued through the new RPC.
- Historical bookings are untouched.

## 8. Statement contents

Rendered by one presentational component used by both the host page and the admin page, inside
`#receipt-print-area` so the existing print CSS applies unchanged (one print area per page).

- **Header:** "Payout Statement", number, status (Paid / REVERSED + date and reason), issue date, transfer date,
  transfer reference.
- **From:** `BUSINESS.name`, DTI No., address, contact (`src/lib/business.ts`).
- **Paid to:** account name, method, account number masked to the last four.
- **Period:** earliest pickup to latest return among the items.
- **Bookings table:** reference, listing, rental dates, rental fee, delivery fee, service fee (with rate when stored),
  your earnings.
- **Summary** — the owner's four figures, defined so they are true under the renter-pays model:

| Line | Value |
|---|---|
| Gross booking value | Σ (rental_fee + delivery_fee + service_fee) |
| Less: Rentivo service fee | Σ service_fee |
| &nbsp;&nbsp;of which delivery fees (paid to you in full) | Σ delivery_fee |
| **Net paid to you** | Σ (rental_fee + delivery_fee) = `amount` |

  With the note: *"The service fee was charged to renters on top of your rental price at checkout. It was not
  deducted from your rental rate."* Gross − fee = net holds exactly. Pre-035 protection fees and pre-070 deposits are
  excluded from "gross booking value" (neither reached the host); 0 paid bookings carry a promo discount, so the gross
  line equals what renters paid for these items.
- **Footer:** "This is a payout statement from Appnado IT Solutions. It is not an official receipt or invoice."

## 9. UI

### 9.1 Admin

- **`/admin/payouts`**
  1. Payout accounts awaiting review (unchanged).
  2. **Owed to hosts** — `payouts_owed()` per host with the blocker column moved here from reports (suspended / no
     account / account under review / rejected / draft open); **Prepare statement** enabled only with no blocker, posting
     the amount the admin is looking at as `expectedAmount`.
  3. **Drafts** — account snapshot (with the changed-account warning), item breakdown, total; **Record transfer**
     (reference + transfer date) and **Cancel draft** (reason).
  4. **Issued** — number, host, amount, transfer date, reference, status, emailed state, link to detail.
- **`/admin/payouts/[id]`** — the statement, Print, **Resend email**, **Reverse** (reason + type the number).
- Routes (all `requireAdminApi()`, admin email passed to the RPC): `POST /api/admin/payout-statements`,
  `…/[id]/issue`, `…/[id]/cancel`, `…/[id]/reverse`, `…/[id]/resend-email`. The old
  `/api/admin/payout-requests/[id]/{paid,failed}` routes and `PayoutRequestActions` are deleted.
- `/admin` overview: "Draft payout statements" replaces "Pending payout requests"; `/admin/reports`' "Unrequested
  payouts" section becomes "Owed to hosts" read from `payouts_owed()`, and its TS mirror is deleted.

### 9.2 Host

- **`/dashboard/payouts`** — "Owed to you" from `my_payout_balance()` with "Rentivo pays out completed rentals to your
  verified account — you don't need to request it"; no button. History shows drafts ("Being prepared"), issued and
  reversed statements linking to **`/dashboard/payouts/[id]`**; cancelled drafts hidden.
- `usePayoutRequests` loses `requestPayout`, `availableBalance` and `pendingPayout`; `usePayoutBalance` (new) wraps the RPC.
- The payout-account-verified email: "Rentivo will send your payouts to this account."

## 10. Email

- **`notifyPayoutStatementIssued(requestId)`** — subject "Payout statement PS-… — ₱X sent"; body is the statement summary
  and booking table built in `email-templates.ts` with every value through `escapeHtml`; the account number masked; CTA
  to `/dashboard/payouts/[id]`. On success the route sets `statement_emailed_at` (service role). A failed send is logged and
  surfaced on the admin page as "Email not sent — Resend", instead of vanishing.
- **`notifyPayoutStatementReversed(requestId)`** — says the payout recorded under that number was reversed, the bookings are
  owed again, and to check their payout account.
- `notifyPayoutPaid` / `notifyPayoutFailed` and `payoutPaidBodyHtml` are deleted.

## 11. Account deletion (`src/lib/account-deletion.ts`)

- **New gate — money owed to the host.** `payouts_owed(uid)` > 0 blocks deletion ("Rentivo still owes this account ₱X. It must
  be paid out first."). Once the account is scrubbed the admin has nowhere to send the money, and the host can no longer see
  it. The existing pending-payout gate now reads "a draft payout statement". A **suspended** host with a balance can be
  neither paid nor deleted until the admin decides — deliberately: that decision should be a person's, not a side effect.
- **Snapshots anonymized in place** on the host's `payout_requests`: `account_name = 'Deleted User'`, `account_number` reduced
  to its last four digits. Statement numbers, amounts, references and items are kept — the financial record, same reasoning
  as `payout_accounts`. `payout_items.listing_title` is kept (the listing row itself is already anonymized; the snapshot is
  the document). `platform_settings` and `payout_statement_counters` hold no personal data.
- `EligibilityResult.blocking` gains `owedAmount: number`; the admin user page renders it.

## 12. Out of scope

- BIR-registered invoices or official receipts for Rentivo's service-fee revenue, and withholding tax on host payouts.
- Automated disbursement (PayMongo payouts API); money still moves by hand.
- Per-host, per-category or promotional rates; a scheduled rate change; notifying hosts or renters of a rate change.
- A service fee deducted from the host (a different business model — see §13).
- A `payout_sent` in-app notification type (needs its own enum migration; email and the dashboard cover it).
- Editing an issued statement. The correction is reverse, then prepare a new one.

## 13. Risks

- **The owner's "gross − service fee = net" wording implies the fee comes out of the host's money. It doesn't.** The renter
  pays it on top, and the host is paid 100% of their rate. The statement is written to be true under that model (§8). If the
  owner actually intends to deduct the fee from hosts, that is a pricing-model change affecting every host's income, the
  host terms and the earnings page — not a statement format.
- **"Invoice".** The owner said invoice; a payout statement is not a BIR invoice. If Rentivo needs BIR-compliant invoices for
  its fee revenue (registered series, ATP/CAS), that is separate work with its accountant.
- **Raising the rate raises every renter's price immediately**, and the legal pages change with it. A renter sees the fee
  before paying, but the terms a returning user accepted named 5%. Announcing changes is left to the owner.
- **Verification touches production.** No local database exists. Phase B's browser task commits one real, bounded rate change
  (§14). Phase C's issue/reverse success paths are proven only inside rolled-back transactions, because a committed test issue
  would permanently occupy a gapless statement number with a fake payout. The first real statement the owner issues is the
  first committed use of that path; the plan carries a checklist for it.
- **Reversal can double-pay** if an admin reverses a transfer that did arrive; mitigated by the typed confirmation and the
  reason, not prevented.
- **The legacy statement `PS-2026-000001`** documents a QA payout (`QA-GCASH-REF-001`) to the demo host. It is honest — that
  row is recorded as paid — but it means the first real statement is `000002`.

## 14. Verification strategy

House pattern: scripts in `scripts/verify/`, throwaway `@example.com` accounts, real sessions for every authorisation claim,
service role only for setup/re-reads/cleanup, every refusal paired with a control, the forbidden host and `RNT-A4DA55` read
only. Plus one new technique:

**Rolled-back SQL probes.** Anything that must not commit (a rate change, a statement number) runs in one
`supabase db query --linked` call as a `do $$ … $$` block that sets `request.jwt.claims` with `set_config(…, true)`, does the
work, and ends with `raise exception 'VERIFY %', <json results>`. The exception rolls everything back; the script parses the
JSON from the error. Each script first proves the harness: inside a probe `auth.uid()` equals the claimed id, and after it a
value written inside is provably absent.

| Migration | Refusal | Control |
|---|---|---|
| 080 | anon and authenticated `select` on `platform_settings` → denied | `current_service_fee_bps()` as anon → 500 |
| 080 | `set_service_fee_bps` as authenticated → permission denied | same call via service role inside a rolled-back probe → succeeds, audit row present inside the probe |
| 080 | 2001 bps, blank reason, no-op → raise | 2000 bps with a reason (rolled back) → succeeds |
| 080 | a booking PATCH of `service_fee_bps` by its renter → denied | PATCH of `renter_notes` → 204 |
| 080 | backfill: every row's stamped rate reproduces its stored fee | counts 6×500 / 13×1200 |
| 081 | probe renter books under a rolled-back 750 → fee = round(rental×0.075), stamped 750 | same probe at the live 500 → stamped 500; a booking created before, re-read after → unchanged |
| 081 | settings row deleted inside a probe → `create_booking` raises | settings present → succeeds |
| 081 | — | `create_booking` ACL identical to before; one overload; body diff = exactly the four hunks |
| 081 | — | JS `serviceFeeFor` = Postgres `round(r*(b/10000.0))` on a grid including all ties |
| 081 (route) | checkout with a deliberately stale `expectedTotal` → 409 `total_changed` with `service_fee_bps` in `amounts`, no intent | matching `expectedTotal` → 200 `qr` |
| 082 | host session: `insert`/`update`/`delete` on the three payout tables → permission denied | `set_payout_account` RPC → succeeds |
| 082 | host calls `create/issue/cancel/reverse_*`, `payouts_owed` → denied | `my_payout_balance()` → own figure; renter → 0 |
| 082 | draft for suspended host / no verified account / wrong expected amount / second draft → raise | eligible probe host with the right amount → draft (committed, later cancelled and deleted) |
| 082 | issue with blank reference, future date, on a cancelled draft → raise | issue inside a probe → `PS-YYYY-<last+1>`; two issues in one probe → consecutive; after the probe the counter is unchanged |
| 082 | cancel an issued statement; reverse a draft → raise | reverse inside a probe → number kept, bookings owed again |
| 082 | concurrent issue from two sessions → second waits and gets the next number (both rolled back) | — |
| 082 | old `request_payout` / `mark_payout_paid` → raise the reload message | — |
| 082 | — | `payout_eligible_bookings` still excludes a `host_qr` and a `test_skip` completed+paid booking while including a `qrph` one |
| 082 | — | legacy row: `PS-2026-000001`, snapshots filled, `amount = Σ items` |
| 083 | the three dropped functions → not found | new RPCs still callable by service role |

Browser, on a production build (port 3100): Phase B — admin changes 5.00% → 5.10% → 5.00% within two minutes while a renter tab
shows the listing and checkout (409 path observed on a probe listing), window bracketed by a query for any non-probe booking
created in it. Phase C — prepare a statement for a probe host, see it on the host dashboard as "Being prepared", attempt Record
transfer with a future date (route refusal observed), cancel it; print and resend-email the legacy `PS-2026-000001` as admin and view
it as the demo host.
