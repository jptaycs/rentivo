# Admin User Management & Business Reports — Design

Date: 2026-09-02
Status: approved, not yet implemented

## Goal

Give the `/admin` panel two capabilities it doesn't have: managing the people on
the marketplace (suspend, delete, inspect), and seeing the business (what is
being rented right now, what commission Rentivo earned, and how much of that it
actually received).

Today `/admin` covers identity verifications and payouts only. There is no way to
remove a spam host, no way to look up a renter, and no view of revenue anywhere —
the closest thing is `/dashboard/earnings`, which is per-host, not platform-wide.

## Decisions (made with user)

1. **Both suspend and delete.** Suspension is reversible (login blocked, listings
   hidden, data kept); deletion is permanent and reuses the existing self-service
   anonymize path. Deletion alone was rejected as an only-option because it can't
   be undone.
2. **Admin deletion is blocked by the same gates as self-service** — an in-flight
   booking (`pending`/`confirmed`/`active`) or a `pending` payout request blocks
   it. No override. Removing a host mid-rental would strand a real renter's paid
   booking. Suspension is always allowed and is the escape hatch.
3. **Commission is reported as earned vs. collected vs. uncollected**, not as one
   number. Rentivo only receives the service fee when its own PayMongo account
   processes the payment; `host_qr` and `test_skip` bookings earn a fee that never
   arrives. A single "commission" figure would overstate real revenue.
4. **Reports tab contains all four views** the user selected: revenue over time
   with the commission split, rentals in flight, top listings/hosts/renters, and
   CSV export on each.

## Approach

Reports are **query-on-read**: server components running aggregate queries through
the service-role client at request time. No materialized views, no rollup tables,
no refresh job.

Considered and rejected for now: precomputed monthly rollups (adds a refresh
mechanism and staleness for a performance problem that does not exist at 16
bookings / 25 listings — this is the upgrade path if volume ever demands it), and
export-only CSV endpoints with no in-app views (cheapest, but doesn't answer the
request).

## §1 · Data model — migration 044

```sql
alter table public.profiles
  add column suspended_at       timestamptz,
  add column suspension_reason  text;

create table public.admin_actions (
  id             uuid primary key default gen_random_uuid(),
  admin_email    text not null,
  action         text not null,          -- 'suspend' | 'unsuspend' | 'delete'
  target_user_id uuid not null,          -- deliberately NOT a FK, see below
  detail         jsonb,
  created_at     timestamptz not null default now()
);

alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;
```

### Why each piece is shaped this way

- **`suspended_at` is a timestamp, not a boolean.** "When was this account
  suspended" is a question the audit trail and the admin UI both want, and a
  nullable timestamp answers it for free. `null` = active.

- **`admin_actions.target_user_id` has no foreign key to `profiles`.** A delete
  action's whole point is that the target may stop being a normal profile row;
  and while the current deletion path anonymizes rather than removes the row, an
  FK here would make the audit log the thing preventing a future hard delete. The
  audit log must never be the reason a cleanup can't run.

- **RLS is enabled in the same migration that creates the table.** Non-negotiable
  in this project — see the ⚠️ grant-audit finding in AGENTS.md: this Supabase
  project grants broad INSERT/UPDATE/DELETE to `anon` and `authenticated` on
  essentially every `public` table independent of what a migration grants, so a
  new table without RLS enabled is fully world-writable the moment it exists. No
  policies are added: `admin_actions` is read and written exclusively by the
  service-role client, which bypasses RLS, so default-deny is exactly right. The
  explicit `revoke all` is belt-and-braces against the same finding: it is not
  what makes the table safe (RLS default-deny is), but it means safety does not
  rest on a single mechanism.

- **Neither new `profiles` column is added to migration 040's `grant update`
  list.** 040 revoked table-level UPDATE on `profiles` and re-granted exactly the
  11 columns the app legitimately writes. Anything not on that list is
  server/RPC-only by default, so a suspended host cannot un-suspend themselves.
  This is the correct default and must not be "fixed" by adding them later.

- **An index on `profiles (suspended_at) where suspended_at is not null`.**
  Suspensions are rare; a partial index keeps the listing-visibility predicate in
  §2 cheap without carrying a full-table index for a column that is almost always
  null.

## §2 · Enforcing a suspension

No single mechanism is sufficient, so there are three, each closing a different
gap.

| Layer | Mechanism | What it does / leaves open |
|---|---|---|
| Login | `auth.admin.updateUserById(uid, { ban_duration })` | Blocks new token issuance. An **already-issued JWT stays valid up to 1 hour** |
| Session | `suspended_at` check in `src/lib/supabase/middleware.ts` | Closes the JWT window on authenticated pages |
| Listings | Suspension predicate in the listings public-read RLS policy + app read paths | Removes their gear from the marketplace |

### Login layer

`ban_duration` is GoTrue's own mechanism, so it blocks at the auth server rather
than in application code. Suspend sets `'876000h'` (~100 years — GoTrue has no
"forever", so a duration past any plausible account lifetime is the idiom);
un-suspend sets `'none'`. The ban duration is deliberately not derived from
`suspended_at`: that column is the record of *when*, the ban is the enforcement.
Conflating them would let a half-failed un-suspend leave an account that looks
active in the admin UI but still cannot log in.

### Session layer

The middleware check runs **only on `PROTECTED_PREFIXES`** (`/dashboard`,
`/host`, `/book`, `/messages`, `/admin`). Those routes already hit the database,
so the extra read costs effectively nothing there, while public browsing — the
overwhelming majority of requests — stays query-free. A suspended user with a
live cookie is redirected to `/login?suspended=1`, which renders a plain "this
account has been suspended — contact support" message above the form rather than
silently 404ing, so they know to contact support instead of assuming a bug. This
reuses the existing login page rather than adding a route, and the middleware
clears the session cookies on that redirect so the next request is a clean
signed-out state. The suspension *reason* is deliberately NOT rendered here: it is
admin-authored free text written for internal use, and it reaches the user only
through the suspension email, a channel the admin knows they are writing for.

### Listing layer

The public-read policy in `003_rls.sql` becomes:

```sql
using (
  is_active = true
  and is_draft = false
  and not exists (
    select 1 from public.profiles p
    where p.id = listings.host_id and p.suspended_at is not null
  )
)
```

**This predicate must be mirrored in the same enumerated app read paths that
already filter `is_draft`:** the RLS policy above, `searchListings`, `getListing`,
`getHostProfile`, `increment_listing_view`, and `create_booking`. That list is
finite and is already documented in AGENTS.md as the set of public read paths, but
it is the real surface area of this feature and the most likely place for the
implementation to be incomplete. Every one of them gets an explicit check during
review.

The host's own views (`/dashboard/listings`) are unaffected — the "host read own"
policy is separate, and a suspended host who regains access should still see
their own inventory.

## §3 · Extracting the deletion logic

`src/app/api/account/delete/route.ts` holds ~200 lines of carefully-reasoned
anonymize-and-purge logic: eligibility gates, profile anonymization, listing
deactivation, storage cleanup across three buckets, `payout_accounts` scrubbed in
place because of an FK with no `on delete` clause, disposable-row deletion, and
finally an auth soft-delete that deliberately keeps the `auth.users` row.

Admin deletion must do **exactly** the same thing. The logic moves to
`src/lib/account-deletion.ts`, exporting:

```ts
checkDeletionEligibility(uid): Promise<{ ok: true } | { ok: false; reason: string; blocking: {...} }>
deleteAccount(uid): Promise<{ ok: true } | { ok: false; error: string }>
```

Both the self-service route and the new admin route call these. The self-service
route keeps its own `confirm: 'DELETE'` check and session handling; only the
shared work moves.

**This is a real improvement beyond the request, not incidental refactoring.**
AGENTS.md carries a standing obligation that every new table, every new PII column
on `profiles`, and every new storage bucket must be added to that purge list.
Today that is one place to update. Copy-pasting the logic into an admin route
would make it two, and the second copy would silently rot — a deleted user's PII
kept forever with nothing to catch it.

The admin route surfaces the eligibility failure rather than swallowing it: the UI
names what is blocking (which bookings, which payout) and points at Suspend, which
is always allowed.

## §4 · Pages and routes

```
/admin/users            list: search by name/email, filter host / renter / suspended
/admin/users/[id]       detail: profile, verification status, listings,
                        bookings as host and as renter, reviews, payout account,
                        and the action buttons
/admin/reports          the four reports in §5
```

```
POST /api/admin/users/[id]/suspend     { reason: string }
POST /api/admin/users/[id]/unsuspend
POST /api/admin/users/[id]/delete      { confirm: 'DELETE' }
```

Each route follows the pattern the four existing admin routes already use:
`requireAdminApi()` first, validate the body, act through `createAdminClient()`,
fire notifications outside the critical path. Each additionally writes an
`admin_actions` row.

**One page serves both hosts and renters.** "Host management" and "renter
management" are the same `profiles` record with a different `is_host` flag; two
screens would render the same table twice. The list has a role filter instead.

**Email, not in-app notification, on suspend/un-suspend.** A suspended user cannot
log in, so a bell notification is unreadable by definition. Two new senders in
`src/lib/email.ts` (`notifyAccountSuspended`, `notifyAccountReinstated`) following
the existing no-op-without-`RESEND_API_KEY` pattern. The suspension email includes
the reason the admin typed. No email on deletion — the account is gone and the
address anonymized.

**Nav:** `/admin/users` and `/admin/reports` are added to the header nav in
`src/app/admin/layout.tsx`, and the overview page gains cards for total users and
suspended users alongside its three existing pending-count cards.

## §5 · Reports

### Commission definitions

These definitions are the substance of this section; the charts are presentation.

- **PayMongo-processed methods** = `card`, `gcash`, `maya`, `qrph`. These are the
  methods where Rentivo's own PayMongo account receives the money, so the service
  fee is genuinely collected.
- **Earned** = `sum(service_fee)` over bookings with `payment_status = 'paid'` and
  `status <> 'cancelled'`.
- **Collected** = Earned, restricted to the PayMongo-processed methods above.
- **Uncollected** = the remainder — `host_qr` (the renter paid the host's personal
  GCash/Maya QR directly, so Rentivo never touched the money) and `test_skip` (the
  pre-launch no-charge testing method).

Bookings with `payment_status = 'refunded'` are excluded from all three: the fee
went back out. `payment_method` is nullable, and the enum still contains unused
`apple_pay`/`google_pay` values, so the collected set is written as an explicit
allowlist (`in (...)`), never as a negation — a future payment method must be
deliberately classified rather than silently counted as revenue.

### The four views

1. **Revenue over time** — monthly gross booking value, commission earned /
   collected / uncollected, and payouts owed vs. paid. Window: the last 12 months,
   bucketed by `bookings.created_at` rather than `pickup_date` — the fee is earned
   when the booking is paid for, not when the gear changes hands. Months with no
   bookings render as explicit zero rows rather than being skipped, so a quiet
   period isn't silently compressed out of the chart.
2. **Rentals in flight** — every booking in `pending`, `confirmed` or `active`,
   with renter, host, item, dates and amount. This is the direct answer to "track
   the product that is just being rented."
3. **Top listings, hosts and renters** — three tables, top 10 each, ranked by
   rental count with total value alongside. Same booking filter as the commission
   figures (paid, not cancelled, not refunded), so nobody tops the table on
   bookings that were never paid for.
4. **CSV export** on each, matching the export pattern `/dashboard/earnings`
   already uses.

Data layer: `src/lib/admin-reports.ts`, server-only, service-role, one exported
function per view. Reports read `bookings` joined to `listings`/`profiles` using
the `LISTING_COLUMNS`/`PROFILE_COLUMNS` allowlists rather than `*` — the admin
client bypasses RLS, so a bare `select('*')` here would pull every column of every
profile into an RSC payload, the same class of mistake as the documented
`street_address` and `qr_payment_label` leaks.

## §6 · Verification plan

- **Access control**: the full matrix — 3 new pages × 3 auth states (signed out,
  signed-in non-admin, admin) and 3 new API routes × 3 auth states — driven with
  forged SSR session cookies, exactly as the existing admin panel was verified.
  Signed out → redirect on pages, 404 on routes; non-admin → 404 everywhere.
- **Suspension lifecycle**, against a **throwaway account only**: suspend →
  confirm login is blocked, confirm an existing session is stopped on a protected
  route, confirm their listings vanish from search, the listing detail page, and
  the host profile → un-suspend → confirm all three restored.
- **Deletion**: confirm the eligibility gate blocks with an in-flight booking and
  with a pending payout; confirm a clean delete anonymizes exactly as self-service
  does; confirm the self-service route still works after the extraction (it is the
  higher-risk half of §3 — it already works today and must not regress).
- **Commission figures** cross-checked by hand against a direct SQL sum, including
  at least one `host_qr` and one `test_skip` booking so the uncollected column is
  provably non-zero rather than accidentally correct.
- **`npm run build` and `npm run lint`** clean.
- **Real user data is never touched**: host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68`
  and booking `RNT-A4DA55` in particular. Every probe row created is deleted and
  the surrounding counts confirmed restored, as in the 040/042 verification runs.

## Out of scope for this pass

Each of these is a deliberate decision, not an oversight:

- **No admin-initiated messaging.** Contacting a user goes through email outside
  the app.
- **No bulk actions.** Suspend/delete are one account at a time; a bulk button is
  how you remove fifty accounts by accident.
- **No refund or booking-cancellation controls in the admin panel.** Those move
  real money and belong to their own design pass.
- **No role system.** `ADMIN_EMAILS` stays the gate. A DB-backed role table is a
  larger change to the security model than this feature justifies.
- **No un-delete.** Deletion stays permanent; suspension is the reversible option.
- **Reports are not scheduled or emailed.** They are pages you visit.
