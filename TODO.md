# Rentivo — To Do

Split out of `AGENTS.md` on 2026-09-04. `AGENTS.md` keeps the project guide (architecture,
security model, Status — Done); this file is the task list. Nothing is duplicated between
them — that file records several incidents where two places drifted and contradicted each
other, so there is exactly one copy of each fact.

**Convention, worth knowing before you skim:** `[x]` items are kept rather than deleted.
Most carry the reasoning for *why* something was done a particular way, or a "this line was
wrong, here is what is actually true" correction — that history is the point, not clutter.
Only `[ ]` items are outstanding.

## Open right now

Two, and neither is blocked on code we control (item 2 was closed 2026-09-12 and is kept
struck through for the record). For work that IS actionable, see
**Unblocked** below — that section is the real queue.

1. **PayMongo KYB** — `gcash`/`maya`/`card` still *Submitted*, not Active. Blocks the
   real-money charge verification and the `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS` removal.
~~2. **Apple Pay / Google Pay**~~ — **done 2026-09-12**, nothing left to do. PayMongo doesn't support them. The tiles were removed
   entirely on 2026-09-12; they had sat as permanently disabled "Coming soon" placeholders
   advertising a choice no renter could make.
3. **Duplicate listing `924ca665-…`** — deactivated, not deleted, because it carries a real
   renter's booking. A decision for the owner, not a task.

~~4. **Retire host commission billing**~~ — **done 2026-09-13.** The condition written here
was "only once PayMongo activates the three methods above", but QR Ph activation alone was
sufficient: it let every payment run through Rentivo's own PayMongo account, so the 5% is
collected at the point of sale and there is nothing to bill back. The `host_qr` method went
with it. The ledger was empty (0 bills, 0 items, checked twice) so no owed money was
destroyed. See AGENTS.md and `docs/superpowers/specs/2026-09-13-retire-host-qr-and-billing-design.md`.

Their full entries, with the reasoning, are in the archive further down.

## Unblocked — actionable now

- [x] **The service fee is hardcoded — an admin cannot change Rentivo's own pricing without
  a migration and a deploy.** **Done 2026-09-15** (migrations 080 + 081, applied to the
  hosted production database and deployed; Phase B of
  `docs/superpowers/plans/2026-09-14-admin-service-fee-and-payout-statements.md`). The rate
  now lives in one row (`platform_settings`, basis points), is read by
  `current_service_fee_bps()`, written only by the `service_role`-only
  `set_service_fee_bps()` behind `/admin/settings`, and is changed from the admin panel with
  a required reason that lands in `admin_actions` in the **same transaction**. **Live rate:
  500 bps (5%)** — unchanged in effect, only in mechanism.
  **The per-booking stamp is the part that matters later.** `create_booking` reads the rate
  **once** and uses it twice — to compute `service_fee` and to stamp
  `bookings.service_fee_bps` — so a receipt can never disagree with what was charged, and a
  rate change never reprices an existing booking. A change that lands mid-checkout surfaces
  through the checkout route's **existing 409 `total_changed`**, with no new code path:
  verified in a browser, the renter saw "Your total is now ₱10,510. The price changed since
  you reviewed it…", the button repriced, and **no PayMongo intent was created**.
  **Backfill counts** (080, measured live before applying and matching the spec exactly):
  **6 bookings at 500 bps, 13 at 1200, 0 matching neither**, 19 total, **0 nulls**, and **0
  rows** where the stamped rate fails to reproduce the stored fee. ⚠️ That backfill's
  unqualified `UPDATE` fired the `bookings_updated_at` trigger and flattened `updated_at` on
  all 19 rows — nothing reads that column, but the old values are gone; **any future
  `bookings` backfill must preserve it explicitly.**
  `SERVICE_FEE_RATE` is **deleted** from `src/lib/pricing.ts`: every percentage on screen is
  now a value read from the server (`getServiceFeeBps()` server-side,
  `useServiceFeeBps()` client-side), except a receipt and an existing booking's summary,
  which read the booking's own stamped rate. The false host-facing "you receive 95%" copy
  went with it — the renter pays the fee on top and the host is paid in full. Full write-up,
  including what the live bracketed rate change did and did not prove, is the
  **Admin-controlled service fee** Status entry in `AGENTS.md`.
  **Phase C — admin-issued payout statements — done 2026-09-15**, entry below.

- [x] **Hosts had to request their own payouts, and nothing documented what was paid.**
  **Done 2026-09-15** (migrations 082 + 083, applied to production and deployed; Phase C of
  `docs/superpowers/plans/2026-09-14-admin-service-fee-and-payout-statements.md`). Rentivo now
  prepares, issues, cancels and reverses numbered payout statements from `/admin/payouts`; the
  host sees a balance, a "Being prepared" line for a draft, and the statement document at
  `/dashboard/payouts/[id]`, and is emailed when a statement is issued or reversed. The Request
  Payout button, `request_payout()`, `mark_payout_paid()` and `mark_payout_failed()` are gone.
  Full write-up is the **Payouts — admin-issued statements** architecture bullet and the
  Status entry in `AGENTS.md`.

- [ ] **The owner's first real payout statement — `PS-2026-000002`.** This is the first
  committed use of the issue path; every test of it so far ran inside a rolled-back
  transaction, because a test issue would permanently occupy a gapless number. When the first
  real host is owed money:
  1. On `/admin/payouts`, **Prepare statement** for the host under *Owed to Hosts*.
  2. **Before transferring**, confirm the draft's account snapshot (method, name, number)
     matches what the host actually wants to be paid to. If it's wrong, cancel the draft, have
     the host fix their payout account, get it re-verified, and prepare again — the statement
     will say the money went to whatever the draft snapshot says.
  3. Transfer the money (GCash/Maya/bank) for **exactly** the draft amount.
  4. On the draft, **Record transfer** with the real reference and the real transfer date
     (today or earlier — a future date is refused).
  5. Confirm the issued statement is numbered **`PS-2026-000002`**, that the host's
     `/dashboard/payouts` shows it, and that the host received the email.
  6. If the Emailed column says **"Email not sent — Resend"**, open the statement and press
     **Send email**; if that also fails, check the Vercel function logs for `[email]` lines.
  7. Only **Reverse** a statement if the transfer genuinely bounced or never arrived —
     reversing makes those bookings owed again, and preparing another statement for them
     would pay twice if the first transfer actually landed.

- [ ] **Phase C review leftovers — owner decisions and one small cleanup** (C10 review,
  2026-09-15; the fixed findings are in the AGENTS.md Status entry).
  - **Statement year = issue year.** A December transfer recorded on January 2 is numbered
    `PS-2027-…`. That is spec §7.5 as written; confirm it's what you want for bookkeeping
    before year-end, since changing it later means two numbering rules in one series.
  - **"of which delivery fees (paid to you in full)" is indented under the service-fee
    line** on both the statement and the email, which can read as if delivery fees are part
    of the fee. Spec §8 prescribes that order; consider moving it or relabelling it
    "Includes delivery fees".
  - **[done 2026-09-15]** **`error.message.replace(/^.*?: /, '')`** removed from the checkout,
    booking-respond and service-fee routes too. Checked live first: PostgREST returns a raise's
    text with no prefix (`create_booking` → "Listing not found or no longer available.",
    `set_service_fee_bps` no-op → its full sentence), so the regex only ever damaged messages
    containing `": "`. After, on a production build: all three routes return the full
    sentence, and respond with a non-UUID id returns `invalid input syntax for type uuid:
    "not-a-uuid"` where it used to return just `"not-a-uuid"`.

- [x] **Two old verification scripts still called the dropped `request_payout()`** — done
  2026-09-15. `scripts/verify/020-mark-payout-failed.mjs` is **deleted**: everything it tested
  (`mark_payout_failed`, `/api/admin/payout-requests/[id]/failed`) no longer exists, and
  cancel/reverse releasing bookings is covered by `082-payout-statements.mjs` and
  `C4-admin-payout-statements.mjs` (git history keeps the old script). `077-…`'s MEDIUM-3
  section is **rewritten**, not dropped, because its rule still exists: a completed-but-not-
  returned booking must not be payable. It now reads the host's own `my_payout_balance()` —
  0 bookings / ₱0 while the only completed booking hasn't reached its return date, then
  exactly 1 booking / its rental + delivery fee once one has. Full 077 run: all checks pass.

- [x] **`message-images` is a PUBLIC storage bucket — private DM attachments are
  anonymously fetchable by URL, forever.** Found by the 2026-09-13 security audit
  (MEDIUM-3). Nothing is exposed *today*: the bucket holds **0 objects**. That is exactly
  why this is worth doing now rather than after people start attaching photos to messages —
  once real attachments exist, closing it means migrating them, and anything already
  scraped stays scraped.
  The fix is not a grants migration: it needs the bucket flipped to private plus
  signed-URL plumbing wherever a message image is rendered (`useConversation.send()`
  uploads; the message bubbles read). Deliberately kept out of migrations 073/074 so a
  schema change and an app change would not ride together.
  **Done 2026-09-14 (migration 075, applied to the hosted DB).** Bucket flipped private;
  the all-roles read policy replaced by uploader-or-conversation-party read, answered by a
  `security definer` helper (`can_read_message_image`) so it can't drift with
  `messages`/`conversations` RLS; a `messages_image_path_shape` CHECK pins `image_url` to
  a bare `<sender uid>/<uuid>.<ext>` path in the sender's own folder (no arbitrary URLs,
  no attaching someone else's object to leak it). App stores the path and renders via one
  batched `createSignedUrls` call per thread (1h). Migration guarded to abort if any
  object/message didn't match the new shape (0/0 at apply time). Verified:
  `scripts/verify/075-private-message-images.mjs` (real sessions; every denial paired
  with a control), plus a production-build browser pass — renter attached and sent a real
  PNG, both renter and host saw it rendered from `/object/sign/` URLs, old public URL 400;
  probe message/object deleted and re-read gone. Deployed 2026-09-14 (`8546ebf`), closing
  the window in which the live CHECK rejected the old app's public-URL image sends.
  **The script's check count is not fixed:** its cleanup emits one check per probe object
  it uploaded (`scripts/verify/075-private-message-images.mjs:304`), so the total varies
  between runs — 37 on its first run, 35 since. A different total is not a regression;
  a `FAIL` line is. Follow-up `1009c77`: an image that can never be signed (object
  deleted, caller not allowed) now reads "Photo unavailable" instead of a loading
  placeholder that never resolved.

- [x] **Skeleton loading states — done 2026-09-14.** Asked for as "add a loading modal every
  click when its loading and button effects when its clicked and skeleton loading"; the top
  progress bar and press effect shipped on 2026-09-13, and `src/components/shared/Skeletons.tsx`
  was written then but **wired into nothing** until now. Route-level `loading.tsx` for home,
  search, listing detail, host profile, `/book` and every `/dashboard/*` route, plus a
  shape-accurate skeleton in place of the full-page spinner on all 16 client dashboard pages
  and `/wishlist`. **Action spinners were deliberately left alone** (Save, Submit, avatar
  upload) — those are click feedback, not page loading, and replacing them would say the page
  is loading when it isn't.
  **Two things worth keeping:** (1) `loading.tsx` is a boundary for its whole segment, not just
  its own page, so the home skeleton sitting in `(main)/loading.tsx` was also the fallback for
  every route in the group without one — a dashboard route rendered a home hero band and
  listing grid for a beat (measured: 6219px of home-shaped skeleton against a 1599px dashboard
  page). Fixed by moving the home page and its skeleton into a `(main)/(home)/` route group
  (groups don't change the URL) and adding `(main)/dashboard/loading.tsx`. Don't move the home
  one back up a level. (2) `animate-pulse` is not reduced-motion-aware on its own; `globals.css`
  freezes it under `prefers-reduced-motion`.
  Verified on a production build at 390×844 with throttled requests, driving the **real login
  form** as both demo accounts (`scripts/verify/skeleton-loading.mjs`, `SKEL_BASE` to retarget):
  a skeleton renders on all nine checked pages, every dashboard route shows the dashboard shape
  with its sidebar and no hero, and no page overflows horizontally at 390px. **The dashboard
  layout-shift numbers in that script are uninformative** — `/dashboard/*` scrolls inside its own
  container, so `body.scrollHeight` is a constant 1599 whether loading or loaded; the shape check
  (sidebar present, hero absent) is what proves those pages, not the height.
  Public pages were re-checked on `rentivo.live` after deploy; the dashboard pages were verified
  on the identical local production build, not on production.

- [x] **Security audit 2 (2026-09-14), database side — done by migration 077.** Two HIGH
  findings, both proven exploitable live: any reviewer could attach a review to *any* listing
  (and hosts could "complete" unpaid bookings to manufacture reviewable ones), and a host could
  double-book dates a renter had paid for (pre-block then delete the block, or confirm two
  overlapping bookings). Plus: hosts completing and requesting payout before a rental happened,
  confirming unpaid bookings, suspended users still writing for up to an hour, forgeable
  message/review timestamps and self-approved verification requests at insert, either party
  overwriting the other's booking notes, unlimited anonymous view inflation, listing deletes
  cascading away renters' inquiry threads, and TRUNCATE still granted to client roles.
  **Why the fixes took the shape they did** (full write-up in AGENTS.md's Security model):
  - every booking rule is a trigger — `create_booking` was not edited (038/039, 040);
  - overlapping confirmations are serialised with a per-listing advisory lock rather than an
    exclusion constraint, because a constraint would make the PayMongo webhook raise after a
    renter's money had already moved; the service-role path records the payment and leaves the
    booking pending for the host to decline and refund;
  - every narrowed INSERT grant was derived from the real call sites first, because 073 once
    missed a value and silently broke host blocked dates in production — and the wizard's
    blocked-date path was re-driven in a real browser this time, not only by script;
  - review `listing_id` is derived by trigger rather than validated, so the client value can't
    matter at all.
  Verified: `scripts/verify/077-booking-lifecycle-and-insert-hardening.mjs` 74/74; regressions
  074, 075, 076 all pass (076's `notified_at` probe updated — a client insert naming it is now
  `permission denied` instead of being silently nulled). Browser pass on a production build
  (port 3100): demo renter sent a message through the real composer (host read it under RLS);
  demo host ran the listing wizard end to end clicking two blocked dates, both
  `availability_blocks` rows (`personal`) confirmed in the database; deleting that listing after
  an inquiry deactivated it with the explanation. All probe rows, the uploaded image and the
  rate-limit hits cleaned up; counts back at the audit baseline.
  **Still open from audit 2, deliberately not in 077:**
  - [x] The confirm-overlap guard's service-role branch leaves a *paid* booking pending, but the
    checkout/webhook still sent the Instant Book "Booking Confirmed" email, because
    `notifyBookingPaid` chose its copy from the listing's `is_instant_book` rather than the
    booking's stored status. **Fixed 2026-09-14:** the copy now keys off `booking.status ===
    'confirmed'`. All five callers (checkout ×2, verify-payment, webhook, /book/complete) run it
    only after `mark_booking_paid` returns, so the status it reads is final. In the rare race
    the renter now gets "Payment Received", which is true, instead of a confirmation the
    database had refused.
  - [x] `view_count` remains a vanity metric (see AGENTS.md) — label it as such on Analytics or
    replace it with a deduplicated events table if it ever matters. **Labelled 2026-09-14:**
    `/dashboard/analytics` now says under the KPI cards that views are approximate and count page
    loads, not unique visitors. A deduplicated events table was not built — still only worth it
    if the number starts mattering.
  - [x] I-2 (storage accepting `..` in object keys and HTML bytes labelled `image/png` in the
    public `listing-images` bucket) and I-6 (`handle_new_user` copying client-supplied
    `avatar_url`) were not addressed. **Done 2026-09-14, migration 079** (see AGENTS.md's ⚠️ 079
    entry): every storage INSERT policy (and the avatars UPDATE policy) refuses a `..` segment;
    `handle_new_user` keeps `avatar_url` only on `lh3.googleusercontent.com` or this project's
    public storage path. The HTML half **cannot** be closed in the database (it can't read
    bytes), so it is a client-side magic-byte check (`src/lib/image-bytes.ts`) in all five upload
    paths — honest limit: a direct Storage API call skips it; origin separation (objects served
    from `supabase.co`, not `rentivo.live`) bounds what that buys an attacker.
  - [x] Default privileges still grant `arwd` on new tables to `anon`/`authenticated`
    (`pg_default_acl`), so "enable RLS in the creating migration" remains non-negotiable.
    **Done 2026-09-14, migration 079** for role `postgres` (the role migrations run as): a new
    table now has no client privileges until its migration grants them, so a forgotten grant
    is a visible 403. RLS in the creating migration **stays** mandatory (checklist in AGENTS.md).
    `supabase_admin`'s identical default ACL can't be changed from a migration (42501,
    `postgres` isn't a member) — it only covers platform-created objects.

- [x] **Rate limiting — done 2026-09-14 (migration 076).** Security audit MEDIUM-4. Built in
  Postgres (no new service); design in AGENTS.md's Security model. **Worse hole found first
  and fixed in the same change:** `/api/messages/notify` emailed the other party on every
  call for a message id — one message plus a loop was an email bomb. It now claims
  `messages.notified_at` once via the service role and sends only on a successful claim.
  **Why each limit sits where it does:**
  - `bookings` trigger, 10/hour per renter — every booking writes a host notification and
    starts an email path; no person legitimately requests ten rentals in an hour. A trigger,
    not a `create_booking` edit, because copying that body caused 038/039 and 040.
  - `messages` trigger, 30/minute per sender — generous for someone typing fast, a hard
    ceiling for a script; covers both the composer's direct insert and `create_inquiry`.
  - checkout 10/10min — each call can create a PayMongo intent; normal retries of a failed
    payment fit easily. Counted before validation so malformed floods count too.
  - notify 60/10min — above the 30/min message cap's sustainable email rate for a real chat,
    and redundant with the once-per-message claim; it exists for id-probing loops.
  - respond / verify-payment 30/10min — a host clearing a queue or a renter tapping "check
    payment" stays far under; each call can refund, email, or hit PayMongo's API.
  - account/delete 5/hour — a real user needs one; each call runs gate queries and deletion.
  All app limits fail open on a limiter error (the triggers remain). Verified:
  `scripts/verify/076-rate-limiting.mjs` 38/38, 074 and 075 regressions green, and a
  production-build browser pass (demo renter signed in via the real form, sent a message,
  it rendered, the notify route claimed once, nothing throttled). **Not covered:** the auth
  endpoints (login/signup/reset) are Supabase GoTrue's own built-in rate limits, not ours.

- [x] **Remove `CRON_SECRET` from the Vercel production dashboard.** **Done 2026-09-14** — removed
  with the Vercel CLI and confirmed gone. It authenticated
  `/api/cron/host-bills`, deleted 2026-09-13. Harmless but misleading to a future reader;
  cannot be scripted from the repo.

- [x] **Next phase must delete the dead `host_qr` branch in `create_booking`** — done
  2026-09-14, migration 078. It rode along with the distance-based delivery-fee rewrite,
  exactly as this item asked: `create_booking` was dropped and re-created for the new
  `p_delivery_lat`/`p_delivery_lng` parameters anyway, so the dead `if p_payment_method =
  'host_qr'` block (its `select qr_payment_url from profiles` referencing a column 072 had
  already dropped) was deleted in that same pass rather than fixed in isolation.
  `scripts/verify/072-retire-host-qr-and-billing.mjs`'s one previously-failing assertion —
  that a direct `host_qr` RPC call raises the trigger's readable message rather than a raw
  `42703` — now passes, and the script is fully green.

- [x] **Distance-based delivery fee** — done 2026-09-14, migration 078 (spec
  `docs/superpowers/specs/2026-09-13-distance-based-delivery-fee-design.md`, plan
  `docs/superpowers/plans/2026-09-14-distance-based-delivery-fee.md`). Delivery pricing was flat-fee
  only; hosts can now also set a per-kilometre rate (`listings.delivery_fee_per_km`) so the
  fee scales with how far the renter actually is, computed server-side by one function
  (`delivery_fee_for`) shared by `create_booking` (the charge) and the `quote_delivery_fee`
  RPC (what checkout displays), so the two can never disagree. See AGENTS.md's Booking
  lifecycle section for the full mechanics and the Security model section for why distance
  is measured from the listing's public approximate point rather than the host's exact pin.
  **Only listings with a host-placed exact pickup point (`location_is_exact = true`) can use
  per-km pricing — and today only a small number of listings have one.** Placing a pin has
  always been optional (065/067); most listings, including the demo host's own three before
  this task placed one on a probe, still carry only the 066 city-centre backfill. A host with
  no pin can still offer flat-fee delivery exactly as before 078. The two host surfaces guard
  this differently, because the wizard's pricing step (3) runs before its location step (5):
  the **edit page** disables the per-km field for a pinless (legacy) listing, with copy
  explaining why (`src/app/(main)/dashboard/listings/[id]/edit/page.tsx:453`); the **wizard**
  needs no such gate, since it requires a pin before Step 5 will let the host continue and
  always inserts `location_is_exact: true` — every listing the wizard creates already has an
  exact pin, so its per-km field (`src/components/host/Step3Pricing.tsx:178-200`) is never
  reachable without one. The database is the backstop either way: `delivery_fee_for` (078)
  refuses a per-km booking against any listing without an exact pin, regardless of what either
  UI does or doesn't enforce.
  **Verified end-to-end 2026-09-14** (task 4 of the plan, independent of task 1's own
  migration script): built and served on port 3100, signed in as the demo host through the
  real login form, placed a pin and set Delivery Base Fee ₱100 / Per Kilometre ₱20 on a real
  listing (`293bea36…`) through the real edit page — confirmed by a direct database read, not
  the "Saved" toast. Signed in as the demo renter, opened `/book`, chose Delivery, and moved
  the pin twice: 1 km away quoted ₱120, 19 km away quoted ₱480, and the Order Summary's
  delivery row and total tracked each quote exactly (₱2,220 then ₱2,580); the payment step's
  "Pay ₱2,580" matched the summary's total. Stopped before paying. A direct `rpc/create_booking`
  call with the demo renter's session and the same 19 km pin returned `delivery_fee: 480,
  delivery_distance_km: 19, total_amount: 2580` — byte-identical to what the browser showed,
  proving the host's saved rate and the renter's quote read the same value all the way through
  to the charge. That probe booking, its trigger-written host notification, and its
  `rate_limit_hits` row were deleted and re-read gone; the listing was restored to its exact
  original `is_active`/`delivery_fee`/`delivery_fee_per_km`/`location_is_exact`/`latitude`/
  `longitude` and re-read to confirm. `npx tsc --noEmit`, `npm run lint`, `npm run build` all
  clean. Neither the forbidden host nor `RNT-A4DA55` were touched.
  **Final review fix (same day):** the spec accepts a renter-supplied pin only because "the
  host sees both before accepting", but no host surface showed the delivery address, pin or
  distance — so a renter could pin next to the listing (cheap) while typing an address 30 km
  away, and under Instant Book the host was silently underpaid. Fixed in `28cec2a`: a
  **paid** delivery booking's card on the host bookings page shows the typed address, stored
  distance, fee, a map of the renter's pin, and a prompt to check the pin against the
  address; the host's new-booking email carries the address, distance and fee (escaped; no
  coordinates, no map link). Unpaid bookings keep "Delivery · city", with the address and
  pin absent from the page payload, so an abandoned booking's pin never reaches a host.

- [ ] **Distance-based delivery — deferred Minors** (three closed 2026-09-14 by 079, marked inline) (final whole-branch review 2026-09-14
  judged none must-fix before shipping; recorded here because the review files lived in a
  scratch workspace that was deleted after merge):
  - **[done 2026-09-14]** **False "price changed" 409 at exact rounding halves on monthly-tier rentals.**
    `pgTierRental` below is now in `calcRentalFee` for both tiers.
    `scripts/verify/079-rental-rounding-parity.mjs` pulls cases from live Postgres and asserts
    parity: 75,454 monthly exact ties (the old float formula mismatched 16,096 of them) and
    124,581 weekly nearest-to-tie cases (fraction 3/7 or 4/7 — true weekly ties can't exist),
    0 mismatches, prices spanning the numeric-weight boundaries up to 100,000,030. Original text: The
    checkout compares the displayed total with the stored one before any charge. JavaScript
    and Postgres disagree at ties — Postgres `round(1029/30.0*45)` = 1544, JS 1543 — so the
    renter is told the price changed when it didn't. It **fails safe** (no charge; the retry
    adopts the stored total) and replaced what was previously a *silent* ₱1 overcharge; 0 of
    22 live tiered listings hit it over 7–365 days; a weekly tie is mathematically impossible.
    **Do not "fix" it with `Math.round(p * d / 30)`:** Postgres rounds `p/30.0` to its
    division scale *before* multiplying, so that version still mismatches 10,800 of 54,000
    ties. The exact fix, verified 0 / 54,000 against live Postgres, emulates numeric division
    scale in `calcRentalFee` (`src/lib/pricing.ts`) for both tiers:
    ```ts
    function pgTierRental(price: number, days: number, div: 30 | 7): number {
      let w = 0, lead = price
      while (lead >= 10000) { lead = Math.floor(lead / 10000); w++ }
      const scale = 10n ** BigInt(Math.max(16 - 4 * (w - (lead < div ? 1 : 0)), 1))
      const q = (2n * BigInt(price) * scale + BigInt(div)) / (2n * BigInt(div))   // round(p/div, rscale)
      return Number((2n * q * BigInt(days) + scale) / (2n * scale))              // round(q*days)
    }
    ```
    The durable alternative — making `create_booking` integer-exact — is another rewrite of
    the riskiest function in the repo and isn't worth it for this alone.
  - **Moving the pin after a payment attempt** leaves the earlier unpaid booking, and any QR
    Ph code already shown for it, payable at the old total. Same shape as the existing
    pickup↔delivery switch; the risk is a double payment, not a wrong amount. Each new
    booking also counts toward the 10/hour limit.
  - **A host switching a listing from flat to per-km mid-checkout** makes the renter's
    retries fail (400) until they reload. No money impact.
  - **The renter's delivery pin reaches the host's browser for unpaid bookings** —
    `useBookings` selects `bookings.*`; the host card hides it, but the data is in the
    response. Same pre-existing pattern as the typed address. Closing it properly needs a
    column-level read restriction or an RPC.
  - **[done 2026-09-14, 079]** **`quote_delivery_fee` has no rate limit.** CPU only; it leaks nothing, since distance is
    measured from the public approximate point. Now `quote:<uid>` 120 per 10 minutes (the client
    debounces at 350ms); the function had to become VOLATILE since the limiter writes. Proven:
    quote 121 refused, 1–120 and a second renter fine.
  - **The ₱100,000 base / ₱10,000 per-km caps are UI-only.** A host writing an absurd rate
    directly gets a refused booking at checkout — fails closed.
  - **The Philippines bounding box (lat 4.0–21.5, lng 116.0–127.0) excludes Kalayaan
    (Pag-asa).** A delivery pin there is refused.
  - **Every paid delivery booking renders its own map** on the host bookings page. Fine at
    today's volume; a long history may want it behind a toggle, like `/dashboard/rentals`.
  - **`create_booking` keeps a comment "mirrors the host_qr guard above"** pointing at a
    block migration 078 deleted. Fix it only as part of a future rewrite of that function,
    never in a standalone one.
  - **[done 2026-09-14]** **Verification script gaps:** `scripts/verify/078-distance-based-delivery-fee.mjs` has no
    check that the quote refuses draft/inactive/suspended listings, check 6 has no dedicated
    control, and check 5's refusal and control use different renters.
    `scripts/verify/072-retire-host-qr-and-billing.mjs` deletes its control booking but not
    the notification and `rate_limit_hits` row that booking's triggers write.
    Now: 078 has check 15 (quote refuses draft, inactive and suspended-host listings, each after
    a control), a dedicated check-6 control, and check 5's control uses the refusal's renter;
    072 deletes the control booking's notification and hit (bounded to that transaction's
    instant) and re-reads to prove all three gone.
  - **A real-phone tap test for the delivery map.** One Leaflet map click didn't register
    under Playwright; a later click did. Not reproduced or root-caused.

- [x] **Guests can view their wishlist** — done 2026-09-14. A guest's hearts were always
  saved (localStorage, via `useWishlist`) but the only page showing them was
  `/dashboard/wishlist`, behind the `/dashboard` auth gate, so the Wishlist tab threw a
  guest at a login wall. Solved with a **public `/wishlist` route** rather than an exception
  in `PROTECTED_PREFIXES` — that blanket gate is a security boundary. `/dashboard/wishlist`
  now redirects there and is still gated. Verified live: hearted two listings as a guest,
  both showed on `/wishlist` with the bottom-nav badge at 2, no overflow at 390px.

- [x] **REMOVE THE SEEDED DEMO REVIEWS BEFORE REAL LAUNCH.** **Done 2026-09-14** with
  `scripts/seed-demo-reviews.mjs remove`: 95 demo reviews and 95 `DEMO-` bookings deleted, none
  on the real host's listing; listing ratings recalculated (19 rated listings → 3); 6 real
  reviews remain. Original text:
  `node --experimental-strip-types scripts/seed-demo-reviews.mjs remove`
  Added 2026-09-06 at the owner's request so a colleague could see a populated
  storefront during a walkthrough: **95 reviews across the 19 seed listings**, each backed by
  a tagged (`DEMO-` booking_ref) booking, because `reviews.booking_id` is NOT NULL.
  **They are invented testimony.** Fine for a demo of placeholder inventory; not fine sitting
  in front of paying strangers, which is why removal is tracked here rather than assumed.
  Two boundaries were kept and should be kept if this is ever re-run: the **real host's
  listing (Isse Capucao, `c38111b3`) was excluded** — inventing reviews about a real person's
  service is a different thing entirely — and the demo bookings are `completed` + **unpaid**,
  so `/admin/reports`, commission, earnings and payout eligibility all filter them out.
  Verified after seeding: commission earned ₱3,168 / collected ₱2,208 and unrequested payouts
  ₱11,800 across 3 — every figure identical to before.

- [x] **The host's typed `street_address` now reaches a confirmed renter** (2026-09-06,
  migration 069). It had been collected, stored, scrubbed on deletion — and shown to nobody,
  while five screens promised it would be shared once a booking was confirmed. The owner chose
  to make the promise true rather than drop the field. `get_listing_coordinates` was extended
  to `returns table (latitude, longitude, street_address)`, keeping ONE gated path rather than
  adding a second function to keep in sync; the `where` clause is byte-identical to 067's, so
  the set of entitled callers did not change — only the columns they receive. Postgres cannot
  change a function's return type in place, so 069 drops and recreates it, **which drops its
  GRANTs** — the same trap as 068's columns — and re-issues them. The renter panel shows the
  address above the map and falls back to city/province when it is null, which is most listings.
  **This is a real disclosure:** a host's full street address now reaches a renter the moment
  their booking is confirmed.
- [x] **`/dashboard/earnings`' CSV export had two defects** (fixed 2026-09-04). It carried
  its own `toCsv()` that interpolated fields into a template string: no formula-injection
  guard, so a host-authored listing title beginning `=`/`+`/`-`/`@` executed as a formula
  when a host opened their own export in Excel — the issue already fixed for `/admin`'s
  exports — and **no quote escaping at all**, so a renter name or title containing `"`
  corrupted the file structurally. Now uses the shared `src/lib/csv.ts`, which is the only
  CSV writer in the app again; `csv.ts`'s own note recording this as an outstanding bug was
  updated, since it no longer is. Verified against the real module: `Juan "JD" Dela Cruz` →
  `"Juan ""JD"" Dela Cruz"`, `=HYPERLINK(…)` → `'=HYPERLINK(…)`, and a numeric `-350` left
  alone rather than becoming `'-350`.
- [x] **`Step3Payment`'s `canPay` didn't gate on the selected method being unavailable**
  (fixed 2026-09-04). The `?? 'qrph'` fallback in the initial state means an empty
  `enabledPaymentMethods()` — every method disabled, e.g. during a PayMongo outage —
  selects `qrph` even though its tile renders "Coming soon", and `canPay`'s `|| isQrph`
  branch then let Pay submit; the checkout route would reject it with a 400 the renter
  can't act on. `canPay` now also requires `!isPaymentMethodDisabled(method)`.
  Proven with a before/after pair rather than by reading: built with
  `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS=gcash,maya,card,qrph` (the value is inlined at
  build time, so this needs its own build) and walked to the payment step in mock mode,
  which makes `/book` reachable with no session. With the fix removed, the agreement
  ticked and Pay read `payDisabled: false`; with it in place, `payDisabled: true` — the
  checkbox genuinely ticked in both runs, so the difference is the guard, not the
  agreement.
- [ ] **MediaPipe's no-SIMD fallback isn't vendored** — *the silent half is fixed; the
  vendoring decision is still open.* Older iOS (<16.4) and Android WebViews request
  `vision_wasm_nosimd_internal.*`, 404 on it, and get a `degraded` (unchecked) ID
  verification pass. That was honest at the database layer — the row is flagged
  `detector_unavailable` — but invisible in the UI, so an uploader on an older phone
  believed their document had passed a check that never ran.
  **Done 2026-09-04:** both upload surfaces (`VerificationCard`, host wizard
  `Step6Verify`) now show an amber notice when the check can't run — "We couldn't run the
  automatic photo check on this device — your documents will go straight to manual review
  instead. You can submit as normal." Amber not red, and suppressed when a real error is
  showing, since nothing is wrong with their photo. Proven with a discriminating pair on a
  throwaway account (never a demo one): with `blaze_face_short_range.tflite` removed the
  amber notice rendered and the file was still accepted; with it restored the same upload
  produced the real red "couldn't find a face" error and **no** amber notice — so the
  notice tracks actual degradation, not a flag that is always on.
  **Still open:** whether to vendor the ~11 MB no-SIMD pair so those devices get a real
  check rather than a manual-review fallback. That is a size/benefit call, not a bug.
- [x] **Listing-wizard photo re-uploads orphaned storage objects** (fixed 2026-09-04).
  `uploadedImagesRef` was a `Map<File, string>`, so it matched on object identity — and
  re-picking a photo after a failed submit produces a brand-new `File` instance, so the
  dedupe missed, the photo uploaded a second time, and the first copy was stranded in
  `listing-images`. Now keyed by `name:size:lastModified`. Verified in a real browser that
  the same file picked twice yields an identical key while a genuinely different file
  yields a distinct one, so the reuse is real and nothing is wrongly deduped.
  **Residual, deliberate:** a photo uploaded on a failed attempt and then *removed* before
  the successful retry is still orphaned — nothing references it, and nothing deletes it.
  Fixing that means deleting objects from the bucket inside the wizard's five-write submit
  sequence, which is the most failure-sensitive path in this codebase; that risk is worse
  than the leak, which is bucket bloat with no user-visible effect.
- [x] **Province fallback pin is now the mean of that province's listed cities**
  (2026-09-04). `getCityCoordinates`' step 4 used `PROVINCE_COORDS`, a table of geographic
  province centres — the wrong target, since the fallback only fires when a host typed a
  city we don't know, and the useful guess is "near the places we do know there", not "the
  middle of the polygon". `PROVINCE_CITY_CENTROIDS` is derived from `CITIES_BY_PROVINCE`
  at module load; `PROVINCE_COORDS` stays for provinces with no listed cities.
  **Measured, not assumed** — provinces whose fallback sat >30 km from their own nearest
  listed city went **11 of 55 → 2**, and every single-city province is now exact. The
  earlier note said "10 of 83 at 31–48 km", which undercounted: Zamboanga del Norte was
  99.1 km out, despite this file's history recording it as "checked and confirmed already
  correct" — that check validated the centre against the province polygon, not against the
  cities we list, which is precisely the distinction this change is about.
  **Known trade-off, deliberately accepted:** a mean sits *between* its inputs, so a
  province with two far-apart cities is now worse, not better — Zamboanga del Sur is 90.8
  km from both Zamboanga City and Pagadian (181.6 km apart), and Surigao del Sur 48.6 km
  from Bislig and Tandag. Those two are the only ones above 30 km.
- [x] **Province fallback snaps to the listed city nearest the mean** (2026-09-04),
  closing the trade-off above. The mean is still what picks the target, but the value
  returned is a real city rather than a point between cities — so the two provinces the
  raw mean made worse are exact again, and a midpoint can no longer land in open water
  (Palawan's offshore centroid, recorded in `ph-locations.ts`, is the precedent).
  Longitude is scaled by `cos(lat)` before ranking candidates, since a degree of longitude
  is 1–6% shorter than a degree of latitude at PH latitudes and that decides near-ties.
  **All 55 provinces with listed cities now land exactly on one**, none over 30 km from
  their nearest — and the snapped choices are the sensible ones: Zamboanga del Sur →
  Pagadian, Surigao del Sur → Tandag (both provincial capitals), Negros Occidental →
  Bacolod. Full resolution order re-checked afterwards: known city, free-text substring,
  the two repeated `Talisay` entries still resolving to different provinces, unknown city
  → snapped fallback, a province with no listed cities → `PROVINCE_COORDS` (Batanes), and
  legacy province `Other` → Manila.
- [x] **`ReviewsList.tsx` fell back to mock reviews on an omitted prop** (fixed
  2026-09-04). The fallback is now gated on `isSupabaseConfigured()`, matching the pattern
  every other mock-importing file in this repo already uses: with a real backend an
  omitted prop renders the empty state, never invented reviews on someone's real listing.
  No behaviour change today — the only call site already passes `undefined` solely in mock
  mode — so this closes the footgun rather than fixing a live bug.
- [x] **`InquiryDialog` didn't restore focus to the "Message Host" button on close**
  (fixed 2026-09-04). base-ui sends focus to `<body>` because the trigger is a plain
  `<button>` toggling state rather than a `DialogTrigger`. `HostCard` now holds a ref to
  it and refocuses on the next animation frame — after base-ui's own focus handling, or it
  would be overwritten. Verified in a browser on a real session: dialog opens, focus starts
  inside it, Escape closes it, and `document.activeElement === ` the trigger button by
  element identity.

- [x] **The `host_qr` earnings question is answered, and answering it exposed a real bug**
  (2026-09-04). The open question was whether `/dashboard/earnings` should keep counting
  only `rental_fee + delivery_fee` for `host_qr`, since the host actually receives the full
  `total_amount` directly. **Host commission billing (061) settled it: no change needed.**
  The host receives everything, but must return the security deposit and is billed the 5%
  service fee back monthly, so what they keep is `rental_fee + delivery_fee` — identical to
  every other method. Before 061 they kept the uncollected service fee, which is what made
  the figure questionable in the first place.
  **The bug next to it was real:** the card labelled **"Pending Payout"** counted every
  `confirmed`/`active` booking regardless of method or payment state, while
  `request_payout()` (029/033) excludes `host_qr` and `test_skip` outright and requires
  `payment_status = 'paid'`. So it forecast money Rentivo will never send. Now filtered to
  match the RPC. Measured against live data: a **real** host's figure dropped ₱600 → ₱0
  (a confirmed but still-unpaid GCash booking — nobody has paid it, so no payout can
  follow), and seed hosts shed ₱1,000 of `host_qr` and ₱7,000 of `test_skip`. "Total
  Earned" deliberately still counts all of them, which is correct — that money was earned,
  just collected by the host rather than routed through Rentivo.

---

**Payments — production hardening**
- [x] **Remove or gate the "Skip Payment" testing method before accepting real customers** — done, and this line described a hole that no longer existed. The tile is gone from `Step3Payment.tsx`'s `BASE_METHODS` and `/api/payments/checkout` rejects `test_skip` via its `CHARGEABLE` allowlist; both pre-date the 2026-09-02 admin workstream. Nothing to hunt here. The `test_skip` enum value and its payout exclusion intentionally survive for historical bookings.
- [x] **`NEXT_PUBLIC_DISABLED_PAYMENT_METHODS` is set in Vercel production** — found already present (added by the account owner ~2026-09-02, value marked sensitive so the CLI can't print it) when the 2026-09-04 deploy went out, and confirmed live in the browser: on `https://rentivo.live`'s payment step GCash/Maya/Card render "Coming soon" and QR Ph is selected by default. This line sat unticked for two days after the fact. When PayMongo activates the methods: `vercel env rm NEXT_PUBLIC_DISABLED_PAYMENT_METHODS production` (or edit the value), then `vercel deploy --prod --yes` — the rebuild is required, the variable is inlined at build time.
- [x] **Set `ADMIN_EMAILS` in Vercel production** — done 2026-09-01 with only `jptayco1109@gmail.com`, verified live; see the admin-panel Status entry. This line sat unticked for a day while two other places said it was done; it is not pending.
- [x] Switch to live PayMongo keys (2026-07-29) — production now processes real money (card/GCash/Maya); local dev deliberately stays on test keys. Not yet verified with an actual real-money charge (that's a deliberate one-off the account owner should do, not something to automate) — the underlying checkout/webhook code path was already verified end-to-end in test mode
- [ ] **Blocked on PayMongo, not code (checked 2026-08-31):** of the checkout methods Rentivo offers, `gcash`/`maya`/`card` still show **Submitted** in the PayMongo dashboard's Payment Methods page (application sent, awaiting PayMongo's approval — cannot process live charges yet, despite live keys being wired in correctly). Likely outstanding KYB/business verification docs on PayMongo's side; check the dashboard for an "action needed" notice or contact PayMongo support. **Don't attempt the real-money charge verification for these three until they flip to Active** — a live attempt today would likely fail/be rejected by PayMongo regardless of the app code.
  As of 2026-09-02 these three are hidden from checkout via `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS=gcash,maya,card` (set in `.env.local` **and in Vercel production** — confirmed live 2026-09-04, see the ticked To Do below; since that date the checkout route also enforces the same list server-side) so renters aren't sent down a dead end. **When PayMongo flips them to Active, remove the value from that env var and redeploy — no code change needed.**
- [x] **`CRON_SECRET` in Vercel production** — set 2026-09-04 (same value as `.env.local`, `vercel env add CRON_SECRET production`), branch merged to `main` and deployed (`vercel deploy --prod --yes`, aliased to `https://rentivo.live`). Verified live: `vercel crons ls` lists `/api/cron/host-bills` on `0 1 1 * *`; the route returns 401 with no `Authorization` header and 200 `{"period":"2026-08-01","created":0}` with the real production secret (correctly 0 — nothing is billable before `POLICY_START`); `/host-terms` 200; `/admin/bills` and `/dashboard/bills` both 307 signed out; home and `/search` 200.
- [x] QR Ph payment method (2026-09-01, 031): added as a real, Rentivo-processed 4th checkout option, since QRPh is the *only* method currently **Active** on the PayMongo account — everything else above is blocked on PayMongo's approval. Same `PaymentIntent`/`PaymentMethod`/`attach` flow as GCash/Maya/Card (`src/lib/paymongo.ts`: `createQrPhPaymentMethod()`, `'qrph'` added to `payment_method_allowed`); the one real difference is PayMongo's response shape — QR Ph's `next_action` returns `{ code: { image_url } }` (an inline QR to scan) instead of `{ redirect: { url } }`, so `/api/payments/checkout` branches on which shape it got back and returns a new `{ status: 'qr', qrImage }` case. Since there's no redirect-back moment to hook a completion check into (the customer scans with a separate app while staying on Rentivo), `BookingWizard.tsx` polls the booking's `payment_status` every 3s while the QR is shown, until the existing PayMongo webhook flips it to `paid` — the webhook itself needed zero changes, it's already payment-method-agnostic. Verified live with real test-mode keys: a real PayMongo intent + `qrph` payment method get created, a real 590×590 base64 QR image renders from PayMongo's actual API response, and Cancel cleanly returns to the payment form. **Not verified**: an actual completed QR Ph payment (would need a real phone scanning a real QR Ph app against PayMongo's sandbox, not something this session could trigger) — the completion path itself (webhook → `mark_booking_paid`) is unchanged, already-proven infrastructure shared with every other method, so this is the same class of "reachable but not scanned-through" gap this project already accepted for the GCash test-mode redirect verification above.
- [x] Deploy (Vercel) — live at `https://rentivo.live` (custom domain, see below), PayMongo webhook registered + `PAYMONGO_WEBHOOK_SECRET` set in Vercel
- [x] Added `https://rentivo-taupe.vercel.app/auth/callback` to Supabase's redirect allow-list (2026-07-19) — prod OAuth/email redirects now work
- [x] Google OAuth consent screen published (2026-07-19) — In production, External: any Google account can sign in. Basic scopes only, so no Google verification required (users may see an "unverified app" note; optional to clear via verification later).
- [x] Supabase auth URL config finalized via Management API (2026-07-19): Site URL → `https://rentivo-taupe.vercel.app`; allow-list now covers `/auth/callback` and `/reset-password` on both localhost and prod (the `/reset-password` entry was missing, which silently broke prod password-reset emails). Note: the Supabase CLI's stored token works against `api.supabase.com/v1/projects/<ref>/config/auth` for this kind of dashboard-only change.
- [x] Custom domain + verified email sending (2026-08-31): bought `rentivo.live` (Namecheap). Added to Vercel (`vercel domains add`, A records `@`/`www` → `76.76.21.21`) and to Resend (DKIM TXT + SPF MX/TXT on `send.rentivo.live`), both confirmed via API polling — Resend domain status `verified`. Updated Vercel prod env (`NEXT_PUBLIC_APP_URL=https://rentivo.live`, `EMAIL_FROM=Rentivo <noreply@rentivo.live>`) and redeployed. Updated Supabase Site URL to `https://rentivo.live` and added `/auth/callback` + `/reset-password` there too (done via the dashboard — CLI's auth token lives in the macOS keychain, which is off-limits to read directly, so this one needed a manual dashboard step rather than the Management API route used for the `rentivo-taupe.vercel.app` entries above). Verified live: `rentivo.live` and `www.rentivo.live` both serve the app (Vercel confirms `"ok": true`), demo-account login still works, and two real Resend sends succeeded — one to the account owner, one to a different recipient — confirming the sandbox 403 restriction is fully lifted, not just for the owner's own inbox.

**Polish / later**
- [x] **`/admin/reports`' payouts column relabeled to say what it actually counts** — the field is now `payoutsRequestedPending` (`src/lib/admin-reports.ts`) and the page header/caption read "Payouts Pending" with an explicit note that this is not total liability to hosts, not "Payouts Owed".
- [x] **Eligible-but-unrequested payout balance — built 2026-09-04.** `/admin/reports` now has an "Unrequested Payouts" section (`getUnrequestedPayouts()` in `src/lib/admin-reports.ts`) mirroring `request_payout()`'s CTE; see the Status entry.
- [x] Apple Pay / Google Pay — blocked: PayMongo doesn't support them; keep "Coming soon" — **superseded 2026-09-12: the tiles were removed entirely** (see "Open right now")
- [x] **`profiles.qr_payment_label` raw-PostgREST exposure — closed 2026-09-04 by migration 059 (column-level SELECT grants, not a policy change, so the `!inner` concern below did not bite; every storefront path re-verified). See the Status entry.** Original text kept for the reasoning: `profiles.qr_payment_label` (host QR payment feature) is still fetchable via a direct anon-key raw PostgREST call even though it's no longer reachable through any app query path — needs a deliberate decision on whether/how to close this (see the Status entry above and the ⚠️ grant-audit note below before attempting a fix; a naive column-level `revoke` may not behave as expected on this project). **New consequence as of the suspension work (2026-09-02):** the only real fix on this project would be narrowing `profiles`' `public read using (true)` policy, and `getFeaturedListings`/`getPopularListings`/`getBundles`/`getActiveListingCount`/`searchListings` are now `!inner` joins on `profiles`. An `!inner` embed the caller cannot read returns **zero parent rows**, so narrowing that policy would blank the entire storefront — home, search and the listing count — rather than degrading cosmetically. Migration 046's `is_host_suspended` helper already protects the *RLS predicate* from the same change (see the ⚠️ note above), but nothing protects these five read paths. Any attempt at this must re-check every `!inner` profiles join first.
- [x] `/dashboard/listings`' "N active listings" header count includes pending-review (`is_draft`) listings — fixed in the host-qa-fixes final-review fix wave (2026-09-02): predicate is now `is_active && !is_draft`.
- [x] `useBookings.ts`'s `BOOKING_SELECT` joins `listings(*)` and `profiles(*)` rather than the `LISTING_COLUMNS`/`PROFILE_COLUMNS` allowlists — fixed in the host-qa-fixes final-review fix wave (2026-09-02); see the Status entry above.
- [x] **Test-looking listings hidden from the marketplace — DECIDED AGAIN 2026-09-06: hide
  them.** This reverses the 2026-09-05 "leave them" decision; the owner asked for the obvious
  test data gone so the marketplace reads as a real, established one. **Deactivated, never
  deleted** — `is_active = false` — because two of them carry history that other things depend
  on: "PayMongo Test Lens (instant)" holds a `confirmed`/`paid` booking and `RNT-75715D`, the
  database's ONLY refunded booking (a documented verification fixture), and "Refund Test Lens A"
  holds the completed booking that the demo host's only `paid` payout request is built on.
  Deleting either would destroy a real renter's record and break documented verifications.
  Also hid "Nikon wad" (junk title, `street_address` "dwa", serial "dwa") — a real signup's
  throwaway listing, hidden rather than deleted because the row is not mine to remove.
  **Dummy/seed accounts and their listings are deliberately KEPT** — 20 realistic listings
  across realistic host names, which is what makes the marketplace look established. Public
  count went 23 → 20; zero test-looking titles remain; every visible listing has an image.
- [ ] Deactivated (not deleted) duplicate listing `924ca665-…` ("Canon G7X Mark III", host Isse Capucao) still exists in the hosted DB — the listing-wizard idempotency fix's own cleanup step found it carried a real booking (`RNT-A4DA55`) from an actual renter and stopped short of deleting it rather than destroy that booking; it was deactivated instead. (That booking was `pending` when it was found, as the dated Status entry above records; as of 2026-09-02 it is `confirmed` and still `unpaid` — it has moved on, it has not gone away.) No further action needed unless the host/renter want it resolved differently.
- [x] **Operational follow-up (host-qa-fixes final review, 2026-09-02) — resolved by the account owner, confirmed 2026-09-02:** migration 037's retroactive sweep had drafted the listings of the then-unverified host Isse Capucao (`c38111b3-9922-4d18-9ae9-a12c8ffb9c68`), leaving a real renter's booking `RNT-A4DA55` rendering with a `null` embedded listing. A direct service-role query during the host/admin QA pass found that host's verification request was approved at `2026-09-02T04:12Z` (and a second host, `52dc28a6`, at `11:36Z`) — hours before that pass ran, so this was the owner working through `/admin`, not an automated change. Both of that host's listings are now `is_draft = false` (one active, one the deliberately deactivated duplicate) and `RNT-A4DA55` is `confirmed`.
- [x] **Dropped spec requirement, built 2026-09-04:** the original spec's §6 said "when PayMongo rejects an inactive method, the checkout route surfaces a specific message instead of a generic failure." The 8-task workstream only shipped `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS` client-side hiding. Now done in two layers — see the Status entry below.
- [x] `mock-data.ts` delivery fees — fixed 2026-09-04: six mock listings now carry a fee (flat, free, or pickup-only spread) so the delivery checkout UI is exercisable without Supabase; see the Status entry.
- [x] Two stale "Key UI Contracts" lines — fixed 2026-09-04: the host-wizard Pricing bullet now mentions the delivery fee (038), and "Trust & safety surfaced in UI" no longer lists "protection at checkout" (discontinued by 035).
- [x] Email notifications for the host-QR-payment flow (2026-09-01): host now gets a "New Booking Request" email at booking creation (new `notifyHostQrBookingRequested`/`hostQrBookingRequestedHtml`, since `hostNewBookingHtml`'s "(paid)" copy would be false at this moment) via a thin `notify-qr-requested` route mirroring `/api/messages/notify`'s shape; renter/host both get the existing `notifyBookingPaid()` dual-send (unmodified — already payment-method-agnostic) via a `notify-qr-paid` route when the host marks payment received. Verified live against the demo accounts: both routes return 200 with correct auth/state gating.
- [x] **Realtime now delivers — fixed 2026-09-03 by migration 057.** `messages` and `notifications` were never members of the `supabase_realtime` publication, so every `postgres_changes` subscription in the app was correctly wired and silently inert, and every prior "verified live" Realtime claim in this file had never actually been confirmed against an open connection. Proven fixed with a before/after probe on a real signed-in session (`delivered=NO` -> `delivered=YES`) for both tables. `conversations` deliberately not added — no hook subscribes to it. Note the ~45s propagation delay documented in the Status entry.
- [x] **Migration 060: drop `messages.booking_id` — done 2026-09-04.** See the Status entry. (This idea was numbered 057, then 058, then 059, then 060 as each number was taken by something more urgent.)
- [x] **Small deferred items from the pre-booking-inquiries final review — all three done 2026-09-04 (migration 058 + `InquiryDialog` rewrite); see the Status entry.** The original text, for the record: (the `useThreads` channel-topic item that was in this list is DONE — it stopped being theoretical the moment a second consumer mounted the hook; see the avatar/scan Status entry)**:** `attach_conversation_to_booking()` (055) doesn't reconcile `host_id` if a listing's host somehow changed between the conversation opening and the booking; `create_inquiry` has no server-side content-length cap beyond the client `maxLength={1000}` on the textarea; `InquiryDialog` has no dialog a11y (`role="dialog"`, Escape-to-close, focus trap). None block the feature; each is a small, independent follow-up.
- [x] **Retire host commission billing once PayMongo activates `gcash`/`maya`/`card`** — **done 2026-09-13 by migration 072** (see "Open right now"; QR Ph activation alone was enough). Original text: (see the Status entry above — it's explicitly temporary). Retiring it is not simply deleting the code the day those methods go Active: any `host_bills` row already `issued` still represents real money genuinely owed and needs collecting or a deliberate admin waiver-void first; `generate_host_bills` should stop being invoked (unset the Vercel cron, or leave it running harmlessly — it only ever bills `host_qr` bookings, which will presumably taper off once the other methods work) rather than being torn out immediately, since a host could still choose direct QR after that point. Needs its own deliberate decision when the time comes, not a reflexive revert.

**Done, 2026-08-23**
- Repo-wide lint cleanup — 22 `react/no-unescaped-entities`, 5 `@typescript-eslint/no-explicit-any`, 8 warnings. Also found and fixed a stale `.claude/worktrees/payout-accounts-history` git worktree (already merged into main) whose unignored `.next` build output was inflating lint output to 1576 errors — removed the worktree and hardened `eslint.config.mjs`'s ignores to also match nested paths (`**/.next/**` etc.) so a future worktree can't repeat this.

**Done, 2026-08-31**
- The last 19 `react-hooks/set-state-in-effect` errors: all came from genuinely idiomatic patterns (the standard `useEffect(() => reload(), [reload])` fetch-on-mount pattern used by nearly every data hook, resetting UI state on prop/route change, deriving local state from async-loaded data) — none were bugs. Restructuring each to avoid the rule (e.g. React's "adjusting state on prop change" recipe) would mean a bespoke rewrite per call site across every core data hook, and this project has no test suite to verify 19 such rewrites don't introduce regressions — the exact risk that had this deferred. Took the safe path instead: a targeted `eslint-disable-next-line` with a one-line justification at each site (19 files, one comment line each, zero logic changes — confirmed via diff). `npm run lint` and `npm run build` are both clean.
