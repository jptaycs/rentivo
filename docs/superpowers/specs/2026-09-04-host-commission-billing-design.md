# Host Commission Billing — Design

**Date:** 2026-09-04
**Status:** Approved (design walked section by section with the owner; see Decisions)

## Goal

Collect Rentivo's 5% service fee on **host-QR bookings**, which today is computed and shown to the renter but never reaches Rentivo — the renter pays the host's personal GCash/Maya QR directly, so the fee sits in the host's wallet. `/admin/reports` shows this as the "Uncollected" commission figure (₱960 of ₱3,168 earned at the time of writing).

This is a **temporary** mechanism for the period in which QR Ph is the only PayMongo method active on the account and direct host QR is therefore the main way renters pay. Hosts who received at least one host-QR booking in a month get a bill for the commission on those bookings, pay it in-app via QR Ph, and lose the direct-QR option (only that option) if the bill goes unpaid past a grace period. When PayMongo activates GCash/Maya/card, every booking flows through PayMongo again and the fee is collected at source; this feature then has nothing to bill and can be retired.

## Decisions (made with the owner)

| Question | Decision | Why |
|---|---|---|
| What is billed | The 5% `service_fee` already charged on each host-QR booking in the month | The renter already paid it into the host's wallet; the bill asks for Rentivo's share back. Same rate as every other method. ₱0 months produce no bill. |
| How the host pays | In-app, QR Ph through PayMongo | The one active PayMongo method. The existing webhook marks it paid; no admin bookkeeping. |
| Unpaid bill | After a 14-day grace period, withhold the **host-QR payment option** on that host's listings | Removes exactly the thing that created the debt. Listings stay live and bookable via PayMongo methods. |
| Delivery | Email + in-app notification, both linking to a new `/dashboard/bills` page | Reuses the two channels booking events already use. A Rentivo-to-host *message thread* was considered and rejected: conversations are always a renter and a host on a listing, so it would need a system account, a new conversation shape and admin UI to write into it, and a thread is a poor place for a Pay button. |
| Who runs billing | Vercel cron on the 1st, plus an admin "Run now" button | Bills go out without anyone remembering; the button covers a missed run, a rerun after a void, and the first run. Generation is idempotent so the two can never double-bill. |
| Retroactive | No — a policy start date; only bookings paid on or after it count | Hosts agreed to nothing before the policy existed. The ₱960 already uncollected stays a reporting figure. |

### Rejected approaches

- **Derive bills on the fly, store only payments.** The "bill" would change under the host when a booking is later refunded, there would be no record of what was actually asked for, and nothing to void.
- **A general host ledger of debits and credits** (commission debits netted against payouts, settlements). The right long-term shape, but too much for a stopgap.
- **Splitting the renter's checkout across two rails** (service fee via QR Ph to Rentivo, the rest via host QR). Two scans and two confirmations per booking, with a half-paid state if the second scan never happens. Rejected by the original host-QR spec for the same reason.

## Data model

Migration **061** (`061_host_bills.sql`) — tables, RLS, RPCs, helper, trigger. Migration **062** (`062_bill_notification_type.sql`) — the enum value, in its own file because Postgres forbids using a new enum value in the transaction that adds it (precedent: 027, 036, 042). 061's `generate_host_bills` therefore references the `bill_issued` type in a **third** migration, **063** (`063_host_bills_notify.sql`), which redefines the function with the notification insert added. Three files, applied in order; 061 is complete and correct without 063 (it just doesn't notify).

### `host_bills`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `host_id` | uuid not null → `profiles(id)` | no `on delete` clause, matching `payout_requests.host_id`; deletion never hard-deletes profiles |
| `period` | date not null | first day of the billed month |
| `amount` | integer not null | pesos, sum of items; `> 0` check |
| `status` | `host_bill_status` enum: `issued` / `paid` / `void` | |
| `issued_at` | timestamptz not null default now() | |
| `due_at` | timestamptz not null | `issued_at + interval '14 days'`, set by the RPC |
| `paid_at` | timestamptz | set by `mark_host_bill_paid` |
| `paymongo_ref` | text | the PayMongo payment-intent id of the *latest* pay attempt; indexed (webhook lookup) |
| `void_reason` | text | required by `void_host_bill` |
| `created_at` | timestamptz not null default now() | |

Unique `(host_id, period)`.

### `host_bill_items`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `bill_id` | uuid not null → `host_bills(id) on delete cascade` | |
| `booking_id` | uuid not null → `bookings(id)` | **unique** — a booking is billed at most once, ever, across all bills |
| `amount` | integer not null | the booking's `service_fee` at billing time |

Void releases items: `void_host_bill` deletes the bill's items (not the bill), so those bookings return to the eligible pool and a rerun bills them again. The unique `booking_id` therefore only ever blocks a booking that is on an `issued` or `paid` bill.

### Eligibility (the one definition, inside `generate_host_bills`)

A booking is billable when **all** of:

- `payment_method = 'host_qr'`
- `payment_status = 'paid'` and `status <> 'cancelled'`
- `paid_at >= '2026-09-05 00:00+08'` (`POLICY_START`, midnight Manila on 2026-09-05, the day after this spec) — a constant in the function body; the same instant is exported from `src/lib/billing.ts` and printed on `/host-terms`
- `paid_at < period + 1 month` — paid before the end of the month being run
- not already present in `host_bill_items`

Note the **absence** of a lower bound on `paid_at` within the period: a booking marked paid late, after its own month was already billed, is picked up by the *next* run rather than lost. The bill's `period` is the run month; each item keeps the booking's real `paid_at` for the breakdown. Bucketing is by `paid_at` (the moment the host pressed "Mark Payment Received"), not the rental dates.

### RPCs (all `security definer`, `set search_path = public`)

- `generate_host_bills(p_period date) returns setof host_bills` — **service_role only**. For each host with billable bookings: insert the bill with `amount = sum(service_fee)`, `due_at = now() + 14 days`, insert one item per booking, then (063) insert a `bill_issued` notification. `on conflict (host_id, period) do nothing` on the bill and the unique `booking_id` on items make a rerun a no-op; the function returns only the bills it created this call. Hosts whose billable total is ₱0 get no row. One CTE per host so amount and items come from one snapshot (the 021 lesson).
- `mark_host_bill_paid(p_bill_id uuid, p_paymongo_ref text) returns host_bills` — **service_role only**, idempotent: `issued → paid` sets `paid_at = now()` and `paymongo_ref`; already `paid` returns the row unchanged; `void` raises.
- `void_host_bill(p_bill_id uuid, p_reason text) returns host_bills` — **service_role only**. `issued → void`, stores the reason (required, non-empty), deletes the bill's items. `paid` raises ("a paid bill cannot be voided"); already `void` returns unchanged.
- `is_host_billing_delinquent(p_host_id uuid) returns boolean` — `security definer`, **granted to anon and authenticated**, `stable`. True when the host has any bill with `status = 'issued' and due_at < now()`. Same shape and reasoning as `is_host_suspended()` (046): the answer must not depend on what the caller may read from `host_bills`.

### Enforcement trigger

`bookings_block_delinquent_host_qr`, `before insert on bookings`: raises when `new.payment_method = 'host_qr' and is_host_billing_delinquent(new.host_id)`. Message: *This host can't accept direct QR payments right now. Please choose another payment method.* A trigger rather than an edit to `create_booking`, whose body has been copied across migrations often enough to cause two security incidents (038/039, 040) and which needs no access to the amounts logic here. Existing unpaid host-QR bookings are untouched; the host can still confirm them.

### Grants and RLS

- `alter table ... enable row level security` in the **same statement block that creates each table** (the project's non-negotiable rule; see AGENTS.md's 016/017 note — a new table without RLS is world-writable here regardless of grants).
- `host_bills`, `host_bill_items`: `grant select to authenticated`; **no** insert/update/delete grant to anon or authenticated. RLS: `host_bills: own read` `using (auth.uid() = host_id)`; `host_bill_items: own read` `using (exists (select 1 from host_bills b where b.id = bill_id and b.host_id = auth.uid()))`. No anon policy.
- `host_bill_status` enum created in 061.
- Migration 017's grant-audit query is re-run against the two tables after applying, and the result recorded.

### Notification type (062)

`alter type notification_type add value if not exists 'bill_issued'`. 063 redefines `generate_host_bills` to insert, per bill: title *Commission bill for {Month YYYY}*, body *₱{amount} for {n} direct QR booking(s). Due {date}.*, link `/dashboard/bills`. `Notification['type']` in `src/types/index.ts` and the notifications page `ICONS` map gain the value (`Receipt` icon, primary blue).

### Account deletion

`src/lib/account-deletion.ts` gains a third eligibility gate: any `issued` bill blocks deletion (400) alongside in-flight bookings and pending payouts — deleting would forgive a real debt. Bills and items are **left untouched** on deletion: they are financial records that reference only `host_id`, hold no PII, and the profile row is anonymized rather than removed. Recorded in the module comment per the standing purge-list obligation.

## Generation and delivery

- **Cron.** New `vercel.json`: `{ "crons": [{ "path": "/api/cron/host-bills", "schedule": "0 1 1 * *" }] }` — 01:00 UTC on the 1st, 09:00 Manila. `GET /api/cron/host-bills` requires `Authorization: Bearer ${CRON_SECRET}` (Vercel sends it automatically when the env var is set); missing or wrong → 401, so the route cannot be triggered by strangers. It computes the previous month, calls `generate_host_bills` via `createAdminClient()`, then fires `notifyHostBillIssued(bill.id)` for each returned bill, fire-and-forget with a console error on failure. Returns `{ period, created: n }`.
- **Admin run.** `POST /api/admin/bills/run` `{ period: 'YYYY-MM' }` behind `requireAdminApi()`, same body as the cron route; returns the count. Pressing it after the cron ran creates nothing.
- **Email.** `notifyHostBillIssued(billId)` in `src/lib/email.ts`: subject *Your Rentivo commission bill for {Month YYYY}*; amount, due date, a row per booking (ref, rental dates, rental fee, service fee), a button to `${APP_URL}/dashboard/bills`, one sentence on what happens after the due date. HTML-escapes everything host- or renter-authored. No-ops with a log line when `RESEND_API_KEY` is absent. Not gated by any `notify_*` preference: it is a bill, not a courtesy.
- **Env.** `CRON_SECRET` added to Vercel production and `.env.local`. No `NEXT_PUBLIC_` variable, so no rebuild is needed to rotate it.

## Paying a bill

- `POST /api/bills/[id]/pay` — cookie session. Loads the bill through the **user's** client (RLS scopes it to the host's own bills; a stranger's bill is a 404), refuses unless `status = 'issued'` (400), then through the service-role client: `createPaymentIntent({ amountCentavos: amount * 100, description: 'Rentivo commission — {Month YYYY}', metadata: { host_bill_id } })`, update `paymongo_ref` on the bill, `createQrPhPaymentMethod()`, `attachPaymentIntent(...)`. Returns `{ qrImage, billId }` from the `code.image_url` branch. A second click creates a fresh intent and overwrites `paymongo_ref`; the earlier intent simply never pays. Any non-QR `next_action` shape or a failed attach → 502 with `paymentErrorMessage`, matching the checkout route.
- **Webhook.** `POST /api/webhooks/paymongo`, `payment.paid` branch: after the existing booking lookup by `paymongo_ref`, **if no booking matched**, look up `host_bills` by `paymongo_ref` and call `mark_host_bill_paid(bill.id, intentId)`. Both RPCs are idempotent, so a replayed event is harmless. Signature verification unchanged. Because a bill intent's `paymongo_ref` is on the bill row, the metadata is informational only.
- **Polling.** `/dashboard/bills` polls the bill's `status` every 3 s while its QR is shown (RLS read, the host's own row), exactly as `BookingWizard` polls a booking's `payment_status`, and flips the row to Paid when the webhook lands. `/book/complete` is not involved.
- **Enforcement release.** The moment `mark_host_bill_paid` runs, `is_host_billing_delinquent` returns false; nothing else needs to happen.

## Screens

### Host — `/dashboard/bills`

Sidebar entry **Bills** (icon `Receipt`) after Earnings in the host nav. Page: a summary card (outstanding total; the line *5% commission on direct QR bookings, billed monthly. Due 14 days after issue.*), then bills newest first: period, amount, due date, status badge (Issued amber, Overdue red when `issued` and past due, Paid green, Void grey), a **Pay** button on issued ones, and an expandable breakdown listing each booking (ref, dates, rental fee, service fee). Pay opens a modal with the QR image, "Scan with any QR Ph app", a Cancel button, and the poll. Empty state: *No bills yet. You're only billed for months with direct QR bookings.* Data via a `useHostBills()` hook (own rows under RLS, items embedded).

### Admin — `/admin/bills`

Nav link **Bills**. Top: a month picker defaulting to last month and a **Run billing** button → `POST /api/admin/bills/run`, showing *Created n bills* (or *Nothing to bill*). Below: a table filtered by `?status=issued|overdue|paid|void|all` (default `issued`): host (name, link to `/admin/users/[id]`), period, amount, issued, due, paid date, PayMongo ref, and a **Void** action with a required reason → `POST /api/admin/bills/[id]/void`. `/admin` overview gains a fourth card, **Overdue bills**, linking to `?status=overdue`. `/admin/reports` gains **Billed** and **Bill payments** figures beside Uncollected (sum of `issued+paid` bill amounts; sum of `paid`), so Uncollected − Bill payments is what is still actually owed. `getUnrequestedPayouts()` is untouched.

### Policy copy

- **`/host-terms`** — a new public page (server component, static) that gives the wizard's dead `Host Terms of Service` link a target. Sections: hosting basics (existing implicit rules gathered in one place: verification before publishing, accurate listings, deposits), and **Commission on direct QR payments**: the 5% is billed monthly for bookings confirmed via the host's own QR, bills are due 14 days after issue, an overdue bill withholds the direct-QR option until paid, and the policy applies to bookings confirmed on or after **5 September 2026**. The date is a constant exported from `src/lib/billing.ts` and must equal the migration's `POLICY_START`.
- **Step 6 of the host wizard** — the checkbox sentence links to `/host-terms`.
- **`QrPaymentCard`** (Settings) — one line above the upload: *Bookings paid through your QR are billed the 5% service fee monthly. See Host Terms.*

## Testing

`scripts/verify/061-host-bills.mjs`, against the hosted database with real sessions for every authorisation claim, admin only for setup/re-reads/cleanup, every probe row removed, baselines asserted before/after, the forbidden host and booking untouched:

1. Throwaway host + throwaway renter + throwaway listing; three `host_qr` bookings via `create_booking`, two marked paid via `confirm_host_qr_payment` as the host (one dated inside the probe period, one dated *after* it via admin `paid_at` patch), one cancelled; plus one paid booking with `paid_at` patched to before 2026-09-05 (pre-policy).
2. `generate_host_bills(period)` twice → exactly one bill, exactly one item (the in-period paid booking), same result set on the rerun (zero created); the cancelled, post-period and pre-policy bookings absent; a `bill_issued` notification row for the host.
3. Run the *next* period → the late-paid booking now billed, on a new bill; the first booking not re-billed.
4. RLS: host reads own bills and items; the renter and a third account read none; direct insert/update/delete on both tables denied for `authenticated` (privilege, not RLS); the 017 grant audit shows only SELECT.
5. `is_host_billing_delinquent`: false while within grace; true after admin patches `due_at` into the past; the `create_booking` `host_qr` call for that host then raises the trigger's message (CONTROL: `qrph` for the same host still succeeds); `mark_host_bill_paid` flips it false and a `host_qr` booking succeeds again; a second `mark_host_bill_paid` is a no-op with the same `paid_at`.
6. `void_host_bill`: on an issued bill stores the reason and deletes items; rerun re-bills the same booking on a new bill; voiding a paid bill raises; void without a reason raises.
7. `POST /api/bills/[id]/pay` on a dev server with the host's forged cookie against test-mode PayMongo: 200 with a real base64 QR image and `paymongo_ref` stored; a stranger's cookie → 404; a paid bill → 400. `GET /api/cron/host-bills` → 401 without the secret, 200 with it.
8. Account deletion: the host with an issued bill → 400 naming the bill; after `mark_host_bill_paid` the gate clears.
9. Playwright: `/dashboard/bills` as the throwaway host shows the bill, breakdown and Pay → QR modal; `/admin/bills` as the local admin shows it, filters, and Void works; `/host-terms` renders the 5 September 2026 date.

**Not verified, by the standing gaps of this project:** email delivery (local sandbox 403), a real QR Ph scan completing (the webhook → `mark_host_bill_paid` path is exercised by calling the RPC directly and by replaying a signed webhook body against the dev route), and the Vercel cron actually firing on the 1st (the route is tested; the schedule is Vercel's).

## Out of scope

Late fees, partial payment, refunds of a paid bill, manual mark-paid (an outside-app payment is handled by **void with a note**), netting against payouts, the general ledger, any change to what renters pay, and billing for `test_skip` bookings (never charged to anyone).

## Retirement

When GCash/Maya/card go Active and the owner retires host QR, the last bill run covers the final month; the tables stay as records; the cron entry, the sidebar item and the checkout gate can be removed in one small change. Nothing here needs to be undone in the database.
