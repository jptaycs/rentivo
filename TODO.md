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

Four, and none of them is blocked on code we control. For work that IS actionable, see
**Unblocked** below — that section is the real queue.

1. **PayMongo KYB** — `gcash`/`maya`/`card` still *Submitted*, not Active. Blocks the
   real-money charge verification and the `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS` removal.
2. **Apple Pay / Google Pay** — PayMongo doesn't support them. Stays "Coming soon".
3. **Duplicate listing `924ca665-…`** — deactivated, not deleted, because it carries a real
   renter's booking. A decision for the owner, not a task.
4. **Retire host commission billing** — only once PayMongo activates the three methods
   above, and not as a reflexive revert (issued bills are real money owed).

Their full entries, with the reasoning, are in the archive further down.

## Unblocked — actionable now

Nothing above can be worked on without PayMongo or an owner decision, so these are the
real queue. Each was recorded as a "deferred, minor" aside inside a Status entry in
`AGENTS.md` rather than tracked here, which is why they were easy to lose.

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
- [ ] **Listing-wizard photo re-uploads orphan storage objects.** The dedupe map is keyed
  by `File` object identity, so going back to Step 1 after a failed submit and re-adding a
  removed photo re-uploads it and strands the earlier object in `listing-images`. Bucket
  bloat only — no duplicate-listing risk.
- [ ] **10 of 83 province centers sit 31–48 km from their nearest listed city.** A
  coarse-fallback precision question, not a correctness one.
- [ ] **`ReviewsList.tsx` falls back to mock reviews when its `reviews` prop is
  `undefined`.** Safe today — its only call site always passes real reviews when Supabase
  is configured — but fragile the moment a second caller omits the prop.
- [ ] **`InquiryDialog` doesn't restore focus to the "Message Host" button on close** (it
  goes to `body`), because that button is a plain `<button>` toggling state rather than a
  `DialogTrigger`. a11y polish.

**A decision, not a task:** `/dashboard/earnings` still counts only `rental_fee` for
`host_qr` bookings, though the host actually received the full `total_amount` directly.
The host commission billing work (061–063) changed the economics here, so this may now be
answerable in a way it wasn't when it was first deferred.

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
- [ ] Apple Pay / Google Pay — blocked: PayMongo doesn't support them; keep "Coming soon"
- [x] **`profiles.qr_payment_label` raw-PostgREST exposure — closed 2026-09-04 by migration 059 (column-level SELECT grants, not a policy change, so the `!inner` concern below did not bite; every storefront path re-verified). See the Status entry.** Original text kept for the reasoning: `profiles.qr_payment_label` (host QR payment feature) is still fetchable via a direct anon-key raw PostgREST call even though it's no longer reachable through any app query path — needs a deliberate decision on whether/how to close this (see the Status entry above and the ⚠️ grant-audit note below before attempting a fix; a naive column-level `revoke` may not behave as expected on this project). **New consequence as of the suspension work (2026-09-02):** the only real fix on this project would be narrowing `profiles`' `public read using (true)` policy, and `getFeaturedListings`/`getPopularListings`/`getBundles`/`getActiveListingCount`/`searchListings` are now `!inner` joins on `profiles`. An `!inner` embed the caller cannot read returns **zero parent rows**, so narrowing that policy would blank the entire storefront — home, search and the listing count — rather than degrading cosmetically. Migration 046's `is_host_suspended` helper already protects the *RLS predicate* from the same change (see the ⚠️ note above), but nothing protects these five read paths. Any attempt at this must re-check every `!inner` profiles join first.
- [x] `/dashboard/listings`' "N active listings" header count includes pending-review (`is_draft`) listings — fixed in the host-qa-fixes final-review fix wave (2026-09-02): predicate is now `is_active && !is_draft`.
- [x] `useBookings.ts`'s `BOOKING_SELECT` joins `listings(*)` and `profiles(*)` rather than the `LISTING_COLUMNS`/`PROFILE_COLUMNS` allowlists — fixed in the host-qa-fixes final-review fix wave (2026-09-02); see the Status entry above.
- [ ] Deactivated (not deleted) duplicate listing `924ca665-…` ("Canon G7X Mark III", host Isse Capucao) still exists in the hosted DB — the listing-wizard idempotency fix's own cleanup step found it carried a real booking (`RNT-A4DA55`) from an actual renter and stopped short of deleting it rather than destroy that booking; it was deactivated instead. (That booking was `pending` when it was found, as the dated Status entry above records; as of 2026-09-02 it is `confirmed` and still `unpaid` — it has moved on, it has not gone away.) No further action needed unless the host/renter want it resolved differently.
- [x] **Operational follow-up (host-qa-fixes final review, 2026-09-02) — resolved by the account owner, confirmed 2026-09-02:** migration 037's retroactive sweep had drafted the listings of the then-unverified host Isse Capucao (`c38111b3-9922-4d18-9ae9-a12c8ffb9c68`), leaving a real renter's booking `RNT-A4DA55` rendering with a `null` embedded listing. A direct service-role query during the host/admin QA pass found that host's verification request was approved at `2026-09-02T04:12Z` (and a second host, `52dc28a6`, at `11:36Z`) — hours before that pass ran, so this was the owner working through `/admin`, not an automated change. Both of that host's listings are now `is_draft = false` (one active, one the deliberately deactivated duplicate) and `RNT-A4DA55` is `confirmed`.
- [x] **Dropped spec requirement, built 2026-09-04:** the original spec's §6 said "when PayMongo rejects an inactive method, the checkout route surfaces a specific message instead of a generic failure." The 8-task workstream only shipped `NEXT_PUBLIC_DISABLED_PAYMENT_METHODS` client-side hiding. Now done in two layers — see the Status entry below.
- [x] `mock-data.ts` delivery fees — fixed 2026-09-04: six mock listings now carry a fee (flat, free, or pickup-only spread) so the delivery checkout UI is exercisable without Supabase; see the Status entry.
- [x] Two stale "Key UI Contracts" lines — fixed 2026-09-04: the host-wizard Pricing bullet now mentions the delivery fee (038), and "Trust & safety surfaced in UI" no longer lists "protection at checkout" (discontinued by 035).
- [x] Email notifications for the host-QR-payment flow (2026-09-01): host now gets a "New Booking Request" email at booking creation (new `notifyHostQrBookingRequested`/`hostQrBookingRequestedHtml`, since `hostNewBookingHtml`'s "(paid)" copy would be false at this moment) via a thin `notify-qr-requested` route mirroring `/api/messages/notify`'s shape; renter/host both get the existing `notifyBookingPaid()` dual-send (unmodified — already payment-method-agnostic) via a `notify-qr-paid` route when the host marks payment received. Verified live against the demo accounts: both routes return 200 with correct auth/state gating.
- [x] **Realtime now delivers — fixed 2026-09-03 by migration 057.** `messages` and `notifications` were never members of the `supabase_realtime` publication, so every `postgres_changes` subscription in the app was correctly wired and silently inert, and every prior "verified live" Realtime claim in this file had never actually been confirmed against an open connection. Proven fixed with a before/after probe on a real signed-in session (`delivered=NO` -> `delivered=YES`) for both tables. `conversations` deliberately not added — no hook subscribes to it. Note the ~45s propagation delay documented in the Status entry.
- [x] **Migration 060: drop `messages.booking_id` — done 2026-09-04.** See the Status entry. (This idea was numbered 057, then 058, then 059, then 060 as each number was taken by something more urgent.)
- [x] **Small deferred items from the pre-booking-inquiries final review — all three done 2026-09-04 (migration 058 + `InquiryDialog` rewrite); see the Status entry.** The original text, for the record: (the `useThreads` channel-topic item that was in this list is DONE — it stopped being theoretical the moment a second consumer mounted the hook; see the avatar/scan Status entry)**:** `attach_conversation_to_booking()` (055) doesn't reconcile `host_id` if a listing's host somehow changed between the conversation opening and the booking; `create_inquiry` has no server-side content-length cap beyond the client `maxLength={1000}` on the textarea; `InquiryDialog` has no dialog a11y (`role="dialog"`, Escape-to-close, focus trap). None block the feature; each is a small, independent follow-up.
- [ ] **Retire host commission billing once PayMongo activates `gcash`/`maya`/`card`** (see the Status entry above — it's explicitly temporary). Retiring it is not simply deleting the code the day those methods go Active: any `host_bills` row already `issued` still represents real money genuinely owed and needs collecting or a deliberate admin waiver-void first; `generate_host_bills` should stop being invoked (unset the Vercel cron, or leave it running harmlessly — it only ever bills `host_qr` bookings, which will presumably taper off once the other methods work) rather than being torn out immediately, since a host could still choose direct QR after that point. Needs its own deliberate decision when the time comes, not a reflexive revert.

**Done, 2026-08-23**
- Repo-wide lint cleanup — 22 `react/no-unescaped-entities`, 5 `@typescript-eslint/no-explicit-any`, 8 warnings. Also found and fixed a stale `.claude/worktrees/payout-accounts-history` git worktree (already merged into main) whose unignored `.next` build output was inflating lint output to 1576 errors — removed the worktree and hardened `eslint.config.mjs`'s ignores to also match nested paths (`**/.next/**` etc.) so a future worktree can't repeat this.

**Done, 2026-08-31**
- The last 19 `react-hooks/set-state-in-effect` errors: all came from genuinely idiomatic patterns (the standard `useEffect(() => reload(), [reload])` fetch-on-mount pattern used by nearly every data hook, resetting UI state on prop/route change, deriving local state from async-loaded data) — none were bugs. Restructuring each to avoid the rule (e.g. React's "adjusting state on prop change" recipe) would mean a bespoke rewrite per call site across every core data hook, and this project has no test suite to verify 19 such rewrites don't introduce regressions — the exact risk that had this deferred. Took the safe path instead: a targeted `eslint-disable-next-line` with a one-line justification at each site (19 files, one comment line each, zero logic changes — confirmed via diff). `npm run lint` and `npm run build` are both clean.
