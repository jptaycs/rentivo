# Self-Service Account Deletion — Design

## Problem

Settings' Danger Zone currently routes account deletion to a `mailto:` link
("Contact Support to Delete Account"). AGENTS.md flags this as deferred
because a real self-serve delete needs a service-role cascade across
listings/bookings/reviews — it's not a quick migration.

## Why not a true hard delete

`bookings.renter_id`/`host_id`, `reviews.reviewer_id`/`reviewee_id`, and
`messages.sender_id` all reference `public.profiles(id)` **without**
`on delete cascade` (checked against `supabase/migrations/001_initial_schema.sql`).
Deleting a profile that has any booking, review, or message — which is
almost every real user — would hit a foreign-key violation immediately.
`profiles.id` itself references `auth.users(id) on delete cascade`, so even
deleting the `auth.users` row cascades into the same wall.

Working around this by cascading deletes through bookings/reviews/messages
would also delete the *other* party's transaction history and reviews —
not acceptable for a marketplace where a host may need that record for
tax/earnings purposes, or a counterparty's review shouldn't vanish because
the reviewee deleted their account.

## Decision: anonymize, don't hard-delete

Scrub PII from `profiles`, disable login, but keep the row and all
FK-referencing history (bookings, reviews, messages, payout requests)
intact. This matches how Airbnb-style marketplaces handle account
deletion — a booking/review record's other party doesn't lose their side
of the transaction.

## Architecture

New route: `POST /api/account/delete`. No new tables or migrations — every
write here uses the existing service-role admin client (already the
pattern in `/api/bookings/[id]/respond` and the payments/webhook routes),
which bypasses RLS, so no new grants are needed either.

### Request

```
POST /api/account/delete
{ "confirm": "DELETE" }
```

Validated server-side (not just client-side) — the literal string `"DELETE"`
is required or the request 400s.

### Step 1: Authenticate

Server client (`@/lib/supabase/server`, cookie-based) — `supabase.auth.getUser()`.
401 if not signed in. The user id being deleted always comes from the
session, never from the request body.

### Step 2: Eligibility gate

Query `bookings` where (`renter_id = uid` OR `host_id = uid`) AND
`status in ('pending','confirmed','active')`, limit 1. Any match → 400:

> "You have an active booking. Please wait for it to complete or cancel it
> before deleting your account."

`completed` and `cancelled` bookings never block — they're just history.

### Step 3: Anonymize (admin/service-role client)

Order matters: everything below runs before the final auth soft-delete, so
a failure partway through never leaves someone logged-out-but-uncleaned.
Each step is safe to re-run (updates reapply the same values; deletes are
no-ops on already-deleted rows), so a retried request after a partial
failure is safe.

1. `profiles` update: `full_name = 'Deleted User'`, `avatar_url = null`,
   `bio = null`, `city = null`, `is_host = false`, `is_verified = false`.
   (`host_rating`/`host_review_count` are left as-is — they're derived from
   reviews that still exist, not new PII.)
2. `listings` update: `is_active = false` where `host_id = uid` — identical
   effect to the existing pause toggle on My Listings.
3. Delete rows (sensitive or disposable, no counterparty depends on them):
   - `payout_accounts` where `user_id = uid` (bank/e-wallet account number)
   - `verification_requests` where `user_id = uid` (capture `id_doc_path`/
     `selfie_path` first, for storage cleanup in step 4)
   - `notifications` where `user_id = uid`
   - `wishlist` where `user_id = uid`
4. Storage cleanup: list and remove everything under `<uid>/` in the
   `avatars` bucket, and the two paths captured from `verification_requests`
   in the `verification-docs` bucket.
5. **Not touched**: `bookings`, `reviews`, `messages`, `payout_requests`,
   `payout_items` — they keep referencing the now-anonymized profile, so
   counterparties retain accurate history.
6. `supabase.auth.admin.deleteUser(uid, /* shouldSoftDelete */ true)` —
   confirmed present in the installed `@supabase/supabase-js` (`deleteUser(id,
   shouldSoftDelete?: boolean)`). This is GoTrue's soft-delete: blocks login
   and frees the email for reuse, without removing the `auth.users` row —
   which matters because that row still needs to exist for `profiles.id`'s
   FK, and hard-deleting it would cascade-delete the very `profiles` row
   step 1 just anonymized.

### Step 4: Response

200 on success. Client then calls `supabase.auth.signOut()` (clears local
session state/cookies) and redirects to `/`.

## UI changes

`src/app/(main)/dashboard/settings/page.tsx`, Danger Zone section:

- Replace the `mailto:...Delete my Rentivo account` link with a "Delete
  Account" button that opens an inline confirmation panel (matching the
  existing add/replace-account form pattern already used elsewhere in the
  dashboard, e.g. Payouts):
  - Warning copy (already present, kept)
  - Text input requiring the literal word `DELETE`
  - Delete button disabled until the input matches exactly
  - On submit: `POST /api/account/delete`
  - Blocking-booking error renders inline as red text (same pattern as
    other forms in this codebase)
  - Success: sign out client-side, redirect to `/`
- "Contact Support" mailto link stays for users who are blocked or hit an
  edge case.

## Out of scope (YAGNI)

- Notifying counterparties by email that a user deleted their account.
- A grace period / undo window before deletion takes effect.
- Admin UI for reviewing deletion requests — this is fully self-service,
  no review step (unlike identity verification or payout account
  approval), since anonymization doesn't require a trust decision the way
  approving a payout account does.
