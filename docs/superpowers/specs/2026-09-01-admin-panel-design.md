# Rentivo Admin Panel (`/admin`) — Design Spec

**Date:** 2026-09-01
**Status:** Approved (brainstorming session with owner)

## Problem

Every admin task today is manual SQL: identity verification review
(`review_verification_request`), payout account review
(`review_payout_account`), and payout settlement (`mark_payout_paid`,
`mark_payout_failed`) are all service-role-only RPCs run by hand from the
Supabase SQL editor, with uploaded documents viewed through the dashboard's
Storage browser. This works for one owner-admin but is slow, error-prone
(hand-typed UUIDs), and silent — the affected user is never told the outcome.

## Goal

A web admin panel at `rentivo.live/admin` covering **all** current
manual-admin tasks, replacing the SQL editor entirely for day-to-day review
work, and sending the affected user an outcome email on every decision.

## Decisions (made during brainstorming)

- **Scope:** all manual-admin tasks — identity verification + payout account
  review + payout request settlement. Not just verification.
- **Auth model:** server-only `ADMIN_EMAILS` env var allowlist. Explicitly
  **not** a `profiles.is_admin` column or an `admin_users` table — this
  project's grant audit (migrations 016/017, see AGENTS.md ⚠️ note) showed
  default grants are broader than migrations declare, so nothing
  self-grantable may exist in the database. An env var has zero
  database-side attack surface.
- **Outcome emails:** yes, on all decisions (verification approved/rejected,
  payout account verified/rejected, payout paid/failed).
- **Placement:** in-app `src/app/admin/` route group in the existing Next.js
  app, deployed with it. Not a separate app/subdomain, not a hosted admin
  tool (which would require handing the service-role key to a third party).

## Architecture

### Access control

- `ADMIN_EMAILS` — server-only env var, comma-separated email list
  (initially just the owner's email). Set in `.env.local` and Vercel
  production. Documented in the `.env.local` placeholder comments like every
  other key.
- New `src/lib/admin.ts`:
  - `isAdminEmail(email: string | undefined): boolean` — case-insensitive
    membership test against the parsed list; `false` when the var is unset
    (panel fails closed).
  - `requireAdmin()` — server-side: reads the session via the existing
    `src/lib/supabase/server` client, checks `user.email` against the list.
    Returns the user, or triggers a 404 (`notFound()` in pages; a 404 JSON
    response helper for API routes). 404 — not 403 — so the panel's
    existence is not advertised to non-admins.
- `src/lib/supabase/middleware.ts`: add `/admin` to `PROTECTED_PREFIXES`
  (signed-out users get the normal login redirect) and additionally return a
  404 rewrite for signed-in non-admin sessions on `/admin` paths.
- **Defense in depth:** the middleware check is a convenience layer only.
  `requireAdmin()` runs in the admin layout's server component **and** at the
  top of every admin API route. No admin data is ever fetched before it
  passes.

### Pages (`src/app/admin/`)

Own minimal layout (simple sidebar/nav: Overview · Verifications · Payouts —
reusing existing UI components/styling; brand palette per AGENTS.md). All
pages are server components that call `requireAdmin()` then fetch with the
existing service-role admin client (`src/lib/supabase/admin`).

- **`/admin`** — overview counts: pending `verification_requests`, pending
  `payout_accounts`, pending `payout_requests`, each linking to its queue.
- **`/admin/verifications`** — queue, `pending` first (filterable to
  all/approved/rejected). Each request shows the submitting user's profile
  (name, city, host/renter, joined date), submitted date, and the ID doc +
  selfie rendered inline via short-lived (~10 min) signed URLs generated
  server-side from the private `verification-docs` bucket. Approve / Reject
  buttons with an optional reviewer-notes field.
- **`/admin/payouts`** — two sections:
  1. Payout accounts awaiting verification (host, method, account name/number
     as stored) with Verify / Reject + notes.
  2. Payout requests: pending ones with amount and the itemized bookings from
     `payout_items`, with Mark Paid (required payment-reference string) and
     Mark Failed (required reason); below, a history of settled requests.

Small client components handle the action buttons/forms (confirm dialog +
POST to the API routes + refresh), mirroring the app's existing
dashboard-page patterns.

### API routes (`src/app/api/admin/…`)

Four thin POST routes, each: `requireAdmin()` → call the **existing,
unchanged** RPC via the service-role client → fire the outcome email
(fire-and-forget) → return the updated row.

| Route | RPC called |
|---|---|
| `POST /api/admin/verifications/[id]/review` `{ approve, notes? }` | `review_verification_request` |
| `POST /api/admin/payout-accounts/[id]/review` `{ approve, notes? }` | `review_payout_account` |
| `POST /api/admin/payout-requests/[id]/paid` `{ reference }` | `mark_payout_paid` |
| `POST /api/admin/payout-requests/[id]/failed` `{ reason }` | `mark_payout_failed` |

**No new migrations.** The RPCs already exist, are service-role-granted, and
are idempotent/state-guarded; the panel is just a new authorized caller.
(Their `service_role`-only grants are untouched — the browser never calls
them directly.)

### Outcome emails

Extend `src/lib/email.ts` with four senders following its established
pattern (recipient resolved via `admin.auth.admin.getUserById(userId)`,
HTML-escaped interpolation, non-fatal failures, console-log no-op without
`RESEND_API_KEY`):

- `notifyVerificationReviewed(userId, approved, notes?)`
- `notifyPayoutAccountReviewed(hostId, approved, notes?)`
- `notifyPayoutPaid(hostId, amount, reference)`
- `notifyPayoutFailed(hostId, amount, reason)`

Not gated by any notification preference — these are decision/receipt
emails, same rationale as the renter payment-confirmation email staying
unconditional. Called fire-and-forget from the admin API routes after the
RPC succeeds; an email failure never fails the admin action.

## Error handling

- RPC errors (not-found id, wrong-state transition — the RPCs already raise
  these) surface as a 400 with the RPC's message; the UI shows it in a toast
  and refreshes so stale queue rows disappear.
- Signed-URL generation failure for a document renders an inline "document
  unavailable" state rather than breaking the request card.
- Missing/empty `ADMIN_EMAILS` → the whole panel 404s for everyone (fails
  closed), including in local dev until the var is added.

## Deliberately out of scope (YAGNI)

- User management, booking management, refund tooling, promo-code admin.
- Admin roles/permissions or multiple-admin workflows beyond the allowlist.
- An audit log — the RPCs already stamp `reviewed_at` / `reviewer_notes` /
  `processed_at`, which is the current record-keeping standard here.
- In-app bell notifications for outcomes — `notifications` rows are written
  only by security-definer triggers today; extending that is separate scope,
  and the outcome emails cover the need.

## Security notes

- No new tables → no new RLS obligations; no new `profiles` columns → the
  account-deletion route's purge list is untouched.
- Signed URLs are short-lived and generated only inside `requireAdmin()`-
  gated server code; document paths/URLs never appear in any non-admin
  response.
- Admin pages/routes return 404 (not 403) to non-admins.
- `ADMIN_EMAILS` compares against the Supabase-session email (verified by
  Supabase auth), not any client-supplied value.

## Verification plan (live, per project convention)

1. Non-admin (demo renter) hits `/admin` and each admin API route → 404,
   no data leaked.
2. Signed-out visitor hits `/admin` → login redirect.
3. Real verification submission (throwaway account) reviewed through the
   panel: approve flips `profiles.is_verified`, reject sets status + notes,
   docs render from signed URLs, email attempt logged/sent.
4. Payout pass against the demo host mirroring the 020–022 live test:
   account verify via panel → payout request → mark paid with reference →
   duplicate-claim still blocked; mark-failed path re-opens eligibility.
5. `npm run build` + `npm run lint` clean; production deploy check that
   `ADMIN_EMAILS` is set in Vercel before announcing.
