# Pre-booking inquiries — design

**Date:** 2026-09-03
**Status:** Approved for planning
**Origin:** User report — "message host is not working."

---

## 1. Problem

Three "Message Host" call sites exist. Two are broken, and they are broken for
two different reasons — one is a plain bug, the other is an architectural gap.

| Site | State |
|---|---|
| `src/app/(main)/dashboard/rentals/page.tsx:189` | **Correct.** Links to `/dashboard/messages?view=renter&booking=<id>`. |
| `src/components/booking/Step4Confirmation.tsx:239` | **Dead.** A `<button>` with no `onClick` at all. It has `booking.id` in scope, so this is a one-line bug. |
| `src/components/listings/HostCard.tsx:68` | **Architecturally impossible today.** Links to a bare `/dashboard/messages` with no `?booking=`, because on a listing page the visitor has no booking with that host — and in this codebase *a thread is a booking*. |

`messages.booking_id` is `not null references bookings(id)`, and every RLS
policy, both hooks (`useThreads`, `useConversation`), `/api/messages/notify` and
`notifyNewMessage()` pivot on it. There is nowhere to put a message from someone
who has not booked yet. That is the actual defect behind the report.

## 2. Goal

A signed-in user can message a host about a listing before booking it. If they
later book that listing, the earlier conversation becomes the booking's thread,
so neither party loses context or re-explains themselves.

### Non-goals

- Host-initiated outreach to renters who have not contacted them. Nothing in the
  report asks for it, and it is the shape most open to abuse.
- Any change to the booking, payment, payout or refund paths.
- Group or multi-listing threads.

## 3. Decisions taken (and why)

| Decision | Choice | Why not the alternative |
|---|---|---|
| Continuity | **Merge** the inquiry into the booking thread | Keeping them separate strands context and shows the host two threads with the same person about the same camera. |
| Who may inquire | **Any signed-in user, rate-limited** | ID-verification-only would suppress most legitimate inquiries, since verification exists for hosts and most renters are unverified. |
| Data model | **A `conversations` table** | See §4. |

### Why a `conversations` table rather than a nullable `booking_id`

Making `messages.booking_id` nullable and deriving thread identity from
`(listing_id, renter, host)` when it is null gives thread identity **two shapes
at once**, so every query, policy and hook branches on which one applies. That
is cheaper to migrate and more expensive forever after, and this repo already
has a documented history of implicit-identity bugs.

With a `conversations` row, "thread" becomes a first-class object, and the merge
is a single field update — the messages never move.

## 4. Data model

```sql
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  renter_id       uuid not null references public.profiles(id),
  host_id         uuid not null references public.profiles(id),
  booking_id      uuid unique references public.bookings(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- At most one OPEN inquiry per renter+listing. PARTIAL, and that is the whole
-- point — see the repeat-rental note below.
create unique index conversations_open_inquiry_key
  on public.conversations (listing_id, renter_id)
  where booking_id is null;

create index conversations_renter_idx on public.conversations(renter_id);
create index conversations_host_idx   on public.conversations(host_id);

alter table public.conversations enable row level security;
```

### ⚠️ The unique index MUST be partial

The obvious constraint — `unique (listing_id, renter_id)` — **is wrong, and it
would fail on the existing data immediately.** A live query on 2026-09-03 found
**4 bookings already sharing a `(listing_id, renter_id)` pair**: the same renter
has rented the same gear more than once. An unconditional unique index cannot
represent that, so the backfill in §7 would abort.

Scoping the index to `where booking_id is null` says the real rule: a renter may
have only one *open, unattached* inquiry per listing, while every booking —
including a repeat rental of the same camera — gets its own conversation.
`booking_id` is separately `unique`, so a booking never has two threads.

### `messages`

- Gains `conversation_id uuid not null references conversations(id) on delete cascade`.
- **Drops `booking_id`**, in its own final migration after the backfill is
  verified (§7). One identity, never two — that is the reason this model was
  chosen over the nullable-column alternative, and keeping the column would
  reintroduce exactly what was rejected.
- Deep links of the form `?booking=<id>` (emails, dashboards) keep working by
  resolving through `conversations.booking_id`.

Migration size is small: **2 messages and 17 bookings** exist at time of writing.

## 5. Security

Consistent with this project's standing rules, which are not optional here:

- `enable row level security` ships **in the same migration that creates the
  table**. This Supabase project grants broad INSERT/UPDATE/DELETE to `anon` and
  `authenticated` on essentially every `public` table regardless of what any
  migration grants, so a new table without RLS is world-writable the moment it
  exists. RLS default-deny — not the absence of a `grant` — is what protects it.
- **`create_inquiry(p_listing_id uuid, p_content text)` is the only insert path**
  for a conversation, as a `security definer` RPC, mirroring `create_booking`.

`create_inquiry` must:

1. Resolve `host_id` from the listing row — **never** accept it as a parameter.
2. Reject the caller's own listing.
3. Reject a listing that is `is_draft` or not `is_active`.
4. Reject a suspended host via `is_host_suspended(host_id)`. A suspended host is
   off the marketplace; letting strangers message them is a channel around that.
5. Enforce the rate limit (§6).
6. Be idempotent: if an open inquiry already exists for `(listing, renter)`,
   reuse it rather than erroring, so a double-submit is harmless.

RLS policies:

- `conversations`: `select` where `auth.uid() in (renter_id, host_id)`. No client
  insert/update/delete policy at all — writes go through the RPC and the trigger,
  both `security definer`.
- `messages`: **all three** existing booking-participant policies are replaced
  with conversation-membership equivalents — `messages: participants read` and
  `messages: participants insert` (003) and `messages: participants update`
  (013, which is what makes read receipts work). Missing the update policy would
  not fail loudly: `useConversation` marks incoming messages read on open, and an
  UPDATE with no matching policy silently changes 0 rows, so read receipts would
  just quietly stop working.
- Migration 013 also issues `grant update (is_read) on public.messages to
  authenticated`. Per migration 040's finding, a **table-level** UPDATE grant
  satisfies a write to *any* column and would make that column list decorative,
  so the planning stage must confirm `messages` does not hold one — otherwise a
  participant could rewrite `content` or `sender_id` on someone else's message.

`last_message_at` is maintained by a trigger on `messages`, not by the client, so
thread ordering cannot be forged.

### Rate limiting

- **One open inquiry per renter+listing** — enforced by the partial unique index,
  i.e. in the database, not merely in RPC code.
- **A rolling 24-hour cap on new conversations per renter** (proposed: 10),
  checked inside `create_inquiry`. This is the first feature where a stranger can
  put text in front of a host with no booking and no payment, and each message
  can trigger an email.

## 6. Merge at booking time — via trigger, deliberately

An `after insert on bookings` trigger (`security definer`) attaches the open
inquiry for that `(listing_id, renter_id)` by setting `booking_id`, or inserts a
conversation if none exists. Every booking therefore has exactly one thread.

**This deliberately does not edit `create_booking`.** That function's body has
already been reproduced several times across migrations, and the project's own
notes record that each reproduction is a chance to disturb the amounts logic —
which has caused two security incidents in this repo. A trigger achieves the same
result without reopening that file.

### Edge case: deleting a booking can violate the partial index

`booking_id` is declared `on delete set null`, so deleting a booking turns its
conversation back into an *open* inquiry — which then falls under
`conversations_open_inquiry_key`. If that renter already has an open inquiry on
the same listing, the delete fails with a unique violation.

The app exposes no booking-delete path (cancellation sets `status`, and account
deletion deliberately preserves bookings), so this is reachable today only from
the SQL editor and from test-cleanup scripts — which this project's verification
passes use routinely. Planning must pick one explicitly rather than discover it
mid-run: either `on delete cascade` (deleting the booking deletes the thread and
its messages), or keep `set null` and have the planner's cleanup scripts delete
the conversation first. Do not leave it unresolved.

Ordering note: the trigger fires on insert, so a conversation exists before any
message can reference the booking. Attaching sets `booking_id` on a row whose
`booking_id` was null, which releases it from the partial unique index — so the
same renter may immediately open a fresh inquiry on that listing.

## 7. Migration order

Each step is its own migration, applied and verified in order:

1. `conversations` + RLS + grants + indexes.
2. Backfill: one conversation per existing booking (`booking_id` set). Repeat
   rentals are fine — the partial index does not apply to attached rows.
3. `messages.conversation_id`, backfilled from `booking_id`, then `set not null`.
4. Replace `messages` RLS with conversation-membership policies.
5. `create_inquiry` RPC + the booking trigger + the `last_message_at` trigger.
6. **Verify**, then drop `messages.booking_id`.

Step 6 is separate and last so that steps 1–5 are reversible.

## 8. Application changes

- **`src/hooks/useThreads.ts`** — reads `conversations` directly instead of
  deriving threads from bookings. Note it currently selects
  `profiles!...(*)`; this rewrite must use the `PROFILE_COLUMNS` allowlist, since
  `select('*')` on a profiles join is the exact shape of the documented
  `qr_payment_label` and `street_address` leaks.
- **`src/hooks/useConversation.ts`** — keyed by `conversation_id`; resolves a
  `?booking=` param through `conversations.booking_id` for existing deep links.
- **`src/lib/email.ts` → `notifyNewMessage()`** — resolves the recipient from
  `conversations` rather than `bookings`. This is *simpler* than today (one fewer
  join) and covers inquiries and bookings uniformly. The `notify_messages`
  preference gate is unchanged.
- **No `notification_type` enum change.** Messages have never written
  `notifications` rows — the bell count comes from `useThreads` and email comes
  from `notifyNewMessage`. So this feature avoids the "new enum value in the same
  transaction" trap that migrations 027/036/042 each had to isolate for.
- **`HostCard.tsx`** — "Message Host" opens an inquiry composer that calls
  `create_inquiry`, then routes to the thread. Signed-out visitors go to
  `/login?next=…` via the existing `safeRedirectPath()`.
- **`Step4Confirmation.tsx`** — the dead button becomes a link to its own
  booking's thread. This is a bug fix that stands on its own.
- **Thread list** — an inquiry shows an "Inquiry" badge in place of a booking ref.

## 9. Verification plan

No test suite exists, so this is live verification against the demo accounts
using the documented forged-SSR-cookie pattern, on a production build.

Before and after the RLS rewrite, both directions:

1. Renter → host and host → renter messaging on an existing booking still works,
   with read receipts and Realtime delivery intact.
2. A third account can read neither the conversation nor its messages.
3. `create_inquiry` refuses: own listing, draft listing, inactive listing,
   suspended host, over-cap sender, and a second open inquiry on the same listing.
4. Booking a listing with an open inquiry attaches it — same thread id, earlier
   messages still present.
5. Booking the **same listing a second time** produces a second conversation and
   does not violate the index.
6. `notifyNewMessage` resolves the correct recipient for both an inquiry and a
   booking thread, and still respects `notify_messages`.

Every probe row is deleted afterwards, and the baseline counts (conversations,
messages, bookings) re-queried and confirmed. Host `c38111b3-…` and booking
`RNT-A4DA55` are not to be touched.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Rewrites RLS and both hooks on a **currently working** feature, with no test suite | Step 6 deferred; steps 1–5 reversible; before/after live verification in both directions |
| A missed RLS policy exposes messages between strangers | Explicit cross-account read test (§9.2) as a required gate, not a spot check |
| Inquiry spam reaching host inboxes | DB-enforced per-listing uniqueness + 24h cap + existing `notify_messages` gate |
| `conversations` is a new table holding participant ids | RLS in the creation migration; re-run migration 017's audit afterwards |

## 11. Open question for the planning stage

The 24-hour cap is proposed at **10 new conversations per renter**. That number
is a guess, not a measurement — there is no traffic data to derive it from. It
should be easy to change in one place in `create_inquiry`.
