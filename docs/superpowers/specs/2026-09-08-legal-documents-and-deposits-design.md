# Legal documents, and stopping deposit collection — design

**Date:** 2026-09-08
**Status:** approved design, not yet planned or implemented

## Why

Rentivo has no Terms of Service, no Privacy Policy, no Rental Agreement and no
Cancellation Policy. It has one document, `/host-terms`, which is really a
commission-and-billing policy for hosts.

Every other legal link in the app is `href="#"`:

| Where | User is agreeing to | Links to |
|---|---|---|
| `SignupForm.tsx:237,239` | Terms of Service, Privacy Policy | `#` |
| `Step3Payment.tsx:460–462` | Rental Agreement, Terms of Service, Cancellation Policy | `#` |
| `settings/page.tsx:389,395` | Terms of Service, Privacy Policy | `#` |
| `Footer.tsx:47–49` | Privacy, Terms, Cookies | `#` |
| `Footer.tsx:37` | Help Center, Safety, Cancellations, Contact Us | `#` |

So both consent checkboxes — signup and checkout — are ticked against documents
that do not exist. Under RA 8792 an electronic tick-box is a valid signature,
but a signature on nothing gives Rentivo no enforceable limitation of liability,
no dispute-resolution clause, and no contractual right to suspend or terminate —
while `/admin` already suspends and deletes accounts today.

The site is live on `rentivo.live` with live PayMongo keys, so this is not
hypothetical.

Three further exposures found while exploring, all specific to this codebase:

1. **Sensitive personal information with no notice.** `verification_requests`
   stores a government ID and a selfie per submission in the private
   `verification-docs` bucket. That is sensitive personal information under
   RA 10173 §3(l), and there is no privacy notice anywhere in the app.
2. **The app states a cancellation policy it does not implement.** Three
   contradictory versions, and the code matches none — see §3.
3. **Security deposits are collected and never returned.** See §2. This is the
   one that blocks everything else, because it is a defect, not a policy.

## Decisions taken (by the repo owner, during brainstorming)

- **Documents describe what the code actually does.** Where the code and the
  copy disagree, the copy is wrong and gets fixed. No policy is written that the
  system does not implement.
- **Contracting party:** Appnado IT Solutions, a DTI- and BIR-registered
  business; Rentivo is its product.
- **Contact address:** `jptayco1109@gmail.com`, for support, privacy requests
  and legal notice. Chosen because it works today. This also replaces the three
  dead `support@rentivo.ph` mailtos — that domain has **no MX records** and
  resolves to a parking IP (`45.79.222.138`), not Rentivo's Vercel deployment,
  so it can neither receive mail nor be assumed to belong to Appnado.
- **Four separate pages**, so each consent link points at the document it names.
- **Rentivo stops collecting security deposits** (see §2).

## 1. Scope

**In:** four legal pages; migration 070 removing the deposit from the charged
total; the app changes that follow from it; wiring every dead legal link;
removing the cancellation and deposit claims the code does not implement.

**Out, deliberately:** business registration, BIR receipting, NPC/DPO
registration, and any claim that these documents are lawyer-reviewed. They are an
honest first draft derived from actual system behaviour, written so a Philippine
lawyer starts from something real rather than a blank page.

## 2. Deposits: stop collecting them

### The defect

`create_booking` adds `listings.security_deposit` to `total_amount`, so the
renter is charged it. `request_payout()` pays hosts `rental_fee + delivery_fee`
(`046_suspension_hardening.sql:105`) — the deposit is **not** included. Nothing
anywhere returns it to the renter: `refundBooking()` only fires on cancellation,
and a grep for any deposit-return path across `src/` finds none.

So for the four PayMongo-processed methods the deposit lands in Rentivo's
PayMongo balance and stays there indefinitely.

Measured on 2026-09-08: **₱32,600 across 5 paid, non-cancelled bookings** — 4 of
them already `completed`, meaning the rental is over and the deposit should have
gone back. All five belong to `Demo Renter`, so **no real customer is currently
owed money.** But QR Ph is the only PayMongo method currently activated, so the
next real booking through it strands a real renter's deposit.

`host_qr` is unaffected: the renter pays the host directly, so the host holds it.

### The fix

Rentivo stops charging the deposit. It becomes an arrangement between host and
renter, collected in person at pickup.

**Migration 070**, mirroring exactly what `035_lower_service_fee_drop_protection_fee.sql`
did to `protection_fee`:

- Copy `create_booking`'s body **verbatim** from
  `045_suspension_visibility.sql` — the authoritative version.
- Change the total from
  `v_rental - v_discount + v_service + v_protection + v_delivery + v_listing.security_deposit`
  to
  `v_rental - v_discount + v_service + v_protection + v_delivery`.
- Insert `security_deposit` as `0` rather than `v_listing.security_deposit`.
- Change nothing else.

`bookings.security_deposit` stays `NOT NULL`, so the five already-charged
bookings keep their real historical amounts and their receipts still add up —
the same reason 035 kept `protection_fee`.

`listings.security_deposit` stays too: the host still declares one, it is still
shown on the listing, it is simply no longer charged through Rentivo.

**AGENTS.md records two security incidents caused by careless reproduction of
`create_booking`'s body (038/039 and 040). Migration 070 must be diffed
line-by-line against 045 before it is applied, and the diff must contain only
the two changes above.**

`request_payout()` needs no change — it never paid the deposit out.

### App changes that follow

| File | Change |
|---|---|
| `src/lib/pricing.ts` | Drop the deposit from the client mirror of the total |
| `src/components/booking/OrderSummary.tsx` | Remove the deposit line from the charged breakdown |
| `src/components/listings/BookingPanel.tsx` | Same |
| `src/components/booking/Step3Payment.tsx` | Consent sentence no longer says the deposit is "refundable upon return" |
| `src/components/booking/Step4Confirmation.tsx` | Receipt row becomes conditional on `> 0`, so pre-070 bookings still show theirs |
| `src/app/(main)/listings/[id]/page.tsx` | Spec row and the Trust & Safety card both reframed: the host collects this at pickup, Rentivo does not charge it |
| `src/components/host/Step3Pricing.tsx`, `ListingWizard.tsx` | Field relabelled "deposit you collect at pickup" |
| `src/app/(main)/dashboard/listings/[id]/edit/page.tsx` | Same |
| `src/lib/admin-reports.ts` | **No change.** "Deposits Held" stays and correctly shows ₱32,600 historical, ₱0 going forward |
| `src/lib/mock-data.ts` | **No change.** `security_deposit` values stay; they are now a host disclosure rather than a charge, which is what mock mode should render |

**The Trust & Safety card is a same-day regression to fix.** Commit `275c9d7`
(2026-09-08) replaced the false "Equipment Protection — covered up to ₱50,000"
claim with "Security Deposit — ₱X collected at checkout for this rental". That
sentence becomes false under 070 and must change in the same change that lands it.

### Accepted trade-off

A host's only recourse for damage becomes what they collect in person. This is a
real reduction in host protection and was taken as a deliberate decision — noting
that the deposit never reached the host anyway, so the protection was already
illusory.

## 3. Cancellation: three stories, none of them true

- `Step1Review.tsx:71` tells renters: *"Free cancellation up to 48 hours before
  pickup. Cancellations within 48 hours are charged 50% of the rental fee.
  No-shows are charged in full."*
- The Settings FAQ says policies *"vary per listing (Flexible, Moderate, or
  Strict)"*.
- **There is no `cancellation_policy` column in the schema.** That per-listing
  feature does not exist.
- `refundBooking()` refunds `total_amount * 100` — **always the full amount**,
  with no time check and no penalty.
- Renters can only cancel `pending` bookings, so the 48-hour rule could never
  fire even if it were implemented.

`/cancellation` states the truth: a renter may cancel before the host accepts; a
paid cancellation is refunded in full; a host may decline a request; there are no
tiers. The 48h/50% copy and the tiers claim are deleted.

## 4. The four documents

Static server components in `src/app/(main)/`, following `/host-terms`'s existing
shape — no new dependency, no layout change.

### `/privacy` — the most substantive

Controller: Appnado IT Solutions. Categories actually collected, named honestly:
profile fields (`full_name`, `avatar_url`, `bio`, `city`); **government ID and
selfie**, flagged as sensitive personal information; listing photos, serial
numbers, street address and exact pickup coordinates; delivery addresses;
messages and message images; payout account numbers and names; GCash/Maya QR
labels (the host's real name and mobile number); wishlist and recently-viewed.

Processors named: Supabase (database, auth, storage), Vercel (hosting), PayMongo
(payments), Resend (email), Google (OAuth, only if used to sign in), Esri (map
tiles — the viewer's browser fetches these, so Esri sees their IP).

Two facts the code genuinely earns and which belong in the notice: the ID face
check runs **entirely on-device** (`src/lib/id-validation.ts`, MediaPipe served
from `public/models/`), and MediaPipe's telemetry endpoint is **blocked by the
CSP's `connect-src`**, so an ID upload does not phone a third party.

Retention: deletion *anonymizes* rather than erases, and why — `bookings`,
`reviews` and `messages` reference `profiles` without `on delete cascade`, so a
hard delete would destroy the counterparty's history. States what is deliberately
retained: financial records (`host_bills`, `payout_requests`), and inquiry
threads as the counterparty's own history.

Rights under RA 10173, and the route to complain to the National Privacy
Commission.

### `/terms`

Rentivo is a **venue, not a party** to any rental: it does not own, inspect,
insure or guarantee equipment. 18+. Scope limited to cameras, lenses and
smartphones. Identity verification required before listings publish (037). Fees:
5% service fee on the rental only, delivery passes through to the host in full,
host-QR commission billed monthly (links `/host-terms`). **Suspension and
termination rights** — currently absent while `/admin` already exercises them.
Prohibited conduct including off-platform payment circumvention. Governing law:
the Philippines.

### `/rental-agreement`

The host↔renter contract, with Rentivo not a party. Valid government ID at
pickup; return in the same condition; no sub-renting or transfer; late return at
1.5× the daily rate. **Deposits are arranged directly with the host and are not
charged or held by Rentivo** (per §2). Loss and damage are settled between host
and renter; Rentivo provides no insurance and operates no claims process.

### `/cancellation`

Per §3.

## 5. Link wiring

Every `href="#"` in the five surfaces above points at its named document.
`Footer.tsx`'s Support column resolves explicitly: Help Center →
`mailto:` the contact address, Safety → `/rental-agreement`, Cancellations →
`/cancellation`, Contact Us → `mailto:`. "Cookies" folds into `/privacy`
rather than becoming a fifth page, since the app sets only its own auth and
preference cookies. The three `support@rentivo.ph` mailtos become the Gmail
address.

## 5a. Phasing

Plan this as **two phases in one plan**, in this order, because the documents
cannot be written honestly until the behaviour they describe is settled:

1. **Deposits** — migration 070 and the app changes in §2, verified on their own.
   This is a money path; it must not be entangled with copy edits in review.
2. **Documents and wiring** — §3, §4 and §5, written against the behaviour
   phase 1 establishes.

## 6. Verification

A `scripts/verify/` script in this repo's usual style:

- All four pages return 200, signed out and signed in.
- **No `href="#"` survives** in `SignupForm`, `Step3Payment`, `settings`, or
  `Footer` — asserted against rendered HTML, not source.
- The removed claims appear nowhere: "48 hours", "Flexible, Moderate, or
  Strict", "refundable upon return", "collected at checkout".
- No `support@rentivo.ph` remains anywhere.
- **Deposit math:** a real `create_booking` call against a listing with a
  non-zero `security_deposit` returns `total_amount` equal to
  `rental_fee - discount + service_fee + delivery_fee`, and stores
  `security_deposit = 0`. Throwaway accounts only; probe booking deleted after.
- A pre-070 booking still renders its historical deposit row.
- Baselines re-queried and confirmed identical; the forbidden host
  (`c38111b3-…`) untouched.

## 7. Known gaps, stated plainly

- **These documents are not legal advice and have not been reviewed by a
  lawyer.** They describe the system accurately; whether they are sufficient
  under Philippine law is a question for counsel.
- The **₱32,600 already held** is not returned by this work. It is all Demo
  Renter test data, so nothing is owed, but the balance stays until someone
  refunds or writes it off deliberately.
- RA 11967 (Internet Transactions Act) obligations beyond disclosure and a
  working redress channel — merchant listing, takedown process — are not
  addressed here.
- NPC registration of the data processing system and a Data Protection Officer
  may be required above the Commission's thresholds. Out of scope; flagged for
  the owner.
