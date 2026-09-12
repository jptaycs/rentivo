# Retire host-QR payment and monthly billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the host-QR payment method and the monthly commission billing system, so every payment runs through Rentivo's PayMongo account where the 5% service fee is collected at the point of sale.

**Architecture:** Pure removal in six tasks. Application code is removed and deployed *first*; the database migration that drops columns and tables runs *last*, because deployed code that names a dropped column breaks every read that embeds it. New host-QR bookings are blocked by replacing an existing trigger, never by editing `create_booking`.

**Tech Stack:** Next.js 16 (App Router), Supabase Postgres + RLS, PayMongo, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-13-retire-host-qr-and-billing-design.md`

## Global Constraints

Every task's requirements implicitly include these. All are copied from the spec.

- **Deployment order is code-then-database.** Tasks 1–4 are code only and must be deployed before Task 5's migration runs. `PROFILE_COLUMNS` names `qr_payment_url`; dropping that column under deployed code that selects it returns 403 on every public listing read, and because five read paths use `!inner` embeds it surfaces as a **silently empty storefront**, not an error.
- **Never edit `create_booking` in this phase.** Blocking new host-QR bookings reuses the trigger slot from migration 061. Two of this repo's documented security incidents (038/039, 040) came from copying that function's body.
- **`request_payout()`'s exclusions of `host_qr` and `test_skip` stay.** `RNT-02A59F` is paid+confirmed and can still reach `completed`; its host already received the renter's money directly, and paying it out again would pay them twice from Rentivo's funds.
- **Keep the `payment_method` enum values `host_qr` and `test_skip`.** Postgres cannot drop an enum value that rows reference, and two historical bookings reference `host_qr`.
- **Keep `Step4Confirmation`'s `host_qr` entry in its payment-method label map**, or the receipt for `RNT-02A59F` renders a blank method.
- **Keep the `bill_issued` notification type and its icon mapping.** No row of that type exists; removing the icon entry only risks a fallback crash.
- **Keep `/api/payments/checkout`'s `.neq('payment_method', 'host_qr')` booking-reuse exclusion.** It prevents charging real money against a historical host-QR booking.
- **Never touch** host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` or booking `RNT-A4DA55` (real user data).
- Verification follows this repo's convention: scripts in `scripts/verify/*.mjs` using `./env.mjs`, real signed-in sessions for any authorisation claim, service role only for setup, independent re-reads and cleanup. There is no unit-test suite.
- Every task ends with `npx tsc --noEmit`, `npm run lint`, `npm run build` clean (the pre-existing `BillPayModal.tsx` `<img>` warning disappears with that file in Task 3; no other warning is acceptable).

---

### Task 1: Remove the renter-facing host-QR checkout path

**Files:**
- Modify: `src/components/booking/Step3Payment.tsx`
- Modify: `src/components/booking/BookingWizard.tsx`
- Modify: `src/components/booking/Step4Confirmation.tsx`
- Modify: `src/app/(main)/dashboard/rentals/page.tsx`
- Delete: `src/app/api/bookings/[id]/qr/route.ts`
- Delete: `src/app/api/bookings/[id]/notify-qr-paid/route.ts`
- Delete: `src/app/api/bookings/[id]/notify-qr-requested/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a checkout with exactly four methods (`gcash`, `maya`, `card`, `qrph`); no component imports `/api/bookings/[id]/qr` any more.

- [ ] **Step 1: Inventory the exact call sites before editing**

```bash
cd /Users/jptaycs/Documents/GitHub/rentivo
grep -n "host_qr\|hostQr\|qrImage\|qrLabel\|awaiting" src/components/booking/Step3Payment.tsx src/components/booking/BookingWizard.tsx src/components/booking/Step4Confirmation.tsx "src/app/(main)/dashboard/rentals/page.tsx"
```

Read every hit before changing anything. `Step4Confirmation` has two kinds of hit: the payment-method **label map** (KEEP) and the awaiting-confirmation **UI branch** (REMOVE).

- [ ] **Step 2: Remove the host-QR tile from the method list**

In `Step3Payment.tsx`, the methods array currently appends a host-QR entry when the host has a QR uploaded:

```ts
const methods = hostHasQr
  ? [...BASE_METHODS, { id: 'host_qr' as const, label: 'GCash/Maya QR (Direct to Host)', logo: '', color: 'border-purple-400', comingSoon: false, unavailable: false }]
  : BASE_METHODS
```

Replace the whole conditional with `const methods = BASE_METHODS`, and delete whatever computes `hostHasQr` (it reads `listing.host?.qr_payment_url`). Remove `'host_qr'` from the file's local `PaymentMethod` union.

- [ ] **Step 3: Remove the direct-`create_booking` branch**

Still in `Step3Payment.tsx`, the host-QR path bypasses `/api/payments/checkout` and calls `create_booking` from the browser, then shows an "awaiting host confirmation" state. Delete that branch entirely so every method goes through the checkout route. Delete any `supabase.rpc('create_booking', …)` call this file makes — after this task the component must contain none.

- [ ] **Step 4: Remove the awaiting-confirmation UI**

In `BookingWizard.tsx` and `Step4Confirmation.tsx`, remove the host-QR success state: the QR image fetch, `qrImage`/`qrLabel` state, the "Loading QR code…" block, the error state for a failed QR fetch, and the copy telling the renter Rentivo doesn't process the payment. **Keep** the `host_qr` key in the payment-method label map.

- [ ] **Step 5: Remove the renter's "View Payment QR" affordance**

In `dashboard/rentals/page.tsx`, remove the button, its modal/panel, the fetch to `/api/bookings/[id]/qr`, and the `is_host_suspended` RPC call that gated it. Leave every other action on that page untouched.

- [ ] **Step 6: Delete the three API routes**

```bash
rm -rf "src/app/api/bookings/[id]/qr" "src/app/api/bookings/[id]/notify-qr-paid" "src/app/api/bookings/[id]/notify-qr-requested"
```

- [ ] **Step 7: Verify no references remain**

```bash
grep -rn "notify-qr\|bookings/\[id\]/qr\|/qr'" src | grep -v node_modules
grep -rn "host_qr" src/components/booking/
```

Expected: the first prints nothing. The second prints **only** the label-map line in `Step4Confirmation.tsx`.

- [ ] **Step 8: Build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add -A src/components/booking src/app/api/bookings "src/app/(main)/dashboard/rentals/page.tsx"
git commit -m "Remove the host-QR checkout path

Renters can no longer pay a host's personal GCash/Maya QR: QR Ph now
works, so payments run through Rentivo's PayMongo account where the
service fee is collected at the point of sale.

Step4Confirmation keeps its host_qr label-map entry so the receipt for
the two historical bookings still names their payment method."
```

---

### Task 2: Remove the host-side QR upload

**Files:**
- Delete: `src/components/shared/QrPaymentCard.tsx`
- Modify: `src/app/(main)/dashboard/settings/page.tsx`
- Modify: `src/hooks/useProfile.ts`
- Modify: `src/app/(main)/dashboard/bookings/page.tsx`
- Modify: `src/lib/listing-columns.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/mock-data.ts`

**Interfaces:**
- Consumes: Task 1's removal of the renter-facing tile (so nothing reads `qr_payment_url` to decide whether to offer it).
- Produces: `useProfile()` returning `{ profile, email, loading, update, uploadAvatar }` only; `PROFILE_COLUMNS` without `qr_payment_url`; `Profile` type without either QR field.

- [ ] **Step 1: Delete the Settings card and its mount**

```bash
rm src/components/shared/QrPaymentCard.tsx
```

Remove the `QrPaymentCard` import and its `<QrPaymentCard />` usage from `dashboard/settings/page.tsx`.

- [ ] **Step 2: Remove the upload helpers from `useProfile`**

Delete `uploadQrCode` and `removeQrCode` and drop them from the returned object, leaving:

```ts
return { profile, email, loading, update, uploadAvatar }
```

- [ ] **Step 3: Remove the host's "Mark Payment Received" action**

In `dashboard/bookings/page.tsx`, remove the button, its handler, and the `supabase.rpc('confirm_host_qr_payment', …)` call. Also remove the `awaitingPayment()` special case that suppressed the hint text for `host_qr` — that branch is now unreachable, and the generic "Awaiting payment" chip is correct for every remaining method.

- [ ] **Step 4: Remove the column from the public profile allowlist**

In `src/lib/listing-columns.ts`, delete `qr_payment_url` from `PROFILE_COLUMNS`. Leave every other column.

- [ ] **Step 5: Remove the fields from the type and mock data**

Delete `qr_payment_url` and `qr_payment_label` from the `Profile` interface in `src/types/index.ts`, and any occurrence in `src/lib/mock-data.ts`. **Do not** touch the `payment_method` union — `host_qr` stays.

- [ ] **Step 6: Verify**

```bash
grep -rn "qr_payment\|QrPaymentCard\|uploadQrCode\|removeQrCode\|confirm_host_qr_payment" src
```

Expected: nothing.

- [ ] **Step 7: Build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: clean. A `tsc` error here most likely means a consumer still destructures `uploadQrCode` from `useProfile()` — fix the consumer, don't re-add the method.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "Remove the host QR upload and its profile columns from the app

The columns themselves are dropped in the migration, which must run
after this ships: PROFILE_COLUMNS named qr_payment_url on every public
listing read, so dropping it under the old code would have emptied the
storefront rather than erroring."
```

---

### Task 3: Remove the billing system code

**Files:**
- Delete: `src/app/(main)/dashboard/bills/`, `src/app/admin/bills/`, `src/app/api/admin/bills/`, `src/app/api/bills/`, `src/app/api/cron/host-bills/`
- Delete: `src/components/dashboard/BillPayModal.tsx`, `src/components/admin/BillRunForm.tsx`, `src/components/admin/BillVoidAction.tsx`, `src/hooks/useHostBills.ts`, `src/lib/billing.ts`
- Modify: `src/app/api/webhooks/paymongo/route.ts`
- Modify: `src/lib/email.ts`
- Modify: `src/components/dashboard/DashboardSidebar.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/reports/page.tsx` (import only — see Step 5b)
- Modify: `src/app/(main)/host-terms/page.tsx`
- Modify: `src/types/index.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: no route, page, hook or helper referencing `host_bills`; the webhook handling only `payment.paid` for bookings.

- [ ] **Step 1: Delete the pages, routes, components and helpers**

```bash
cd /Users/jptaycs/Documents/GitHub/rentivo
rm -rf "src/app/(main)/dashboard/bills" src/app/admin/bills src/app/api/admin/bills src/app/api/bills src/app/api/cron/host-bills
rm -f src/components/dashboard/BillPayModal.tsx src/components/admin/BillRunForm.tsx src/components/admin/BillVoidAction.tsx src/hooks/useHostBills.ts src/lib/billing.ts
```

- [ ] **Step 2: Remove the bill branch from the PayMongo webhook**

In `src/app/api/webhooks/paymongo/route.ts`, the `payment.paid` handler matches an intent back to a `host_bills` row by `paymongo_ref` (with a metadata `host_bill_id` fallback) and calls `mark_host_bill_paid`. Remove that entire branch and its helper. The booking branch is untouched.

- [ ] **Step 3: Remove the bill email**

Delete `notifyHostBillIssued` from `src/lib/email.ts` and any template it owns. Leave every other sender.

- [ ] **Step 4: Remove the navigation entries**

Remove the `Bills` item from `HOST_NAV` in `src/components/dashboard/DashboardSidebar.tsx`, and the **Overdue bills** overview card plus its Bills link from `src/app/admin/page.tsx`.

- [ ] **Step 5: Remove the types and the cron**

Delete `HostBill` / `HostBillItem` (and any bill-shaped types) from `src/types/index.ts`. Replace `vercel.json` with:

```json
{}
```

Leave the `bill_issued` value in the `Notification['type']` union and its icon mapping — see Global Constraints.

- [ ] **Step 5b: Clear the remaining `lib/billing` importers**

`src/lib/billing.ts` is imported by eight files. Deleting it in Step 1 while
any importer survives breaks this task's own build gate, so every one must go
in this task:

- `src/lib/email.ts` — drop the `periodLabel` import along with
  `notifyHostBillIssued` (Step 3).
- `src/app/admin/reports/page.tsx` — drop the `POLICY_START_LABEL` import and
  whatever renders it. Leave the page's figures alone; Task 4 owns those.
- `src/app/(main)/host-terms/page.tsx` — drop the
  `POLICY_START_LABEL, GRACE_DAYS` import, delete the whole "Commission on
  direct QR payments" section, and make the service-fee line in "Hosting on
  Rentivo" state the current truth:

```tsx
<li>Rentivo charges a 5% service fee on the rental fee of every booking, deducted from the payment when it is processed. Delivery fees you set are paid to you in full.</li>
```

Confirm with:

```bash
grep -rn "from '@/lib/billing'" src
```

Expected: nothing.

- [ ] **Step 6: Verify**

```bash
grep -rn "host_bill\|HostBill\|useHostBills\|generate_host_bills\|mark_host_bill_paid\|void_host_bill\|is_host_billing_delinquent\|lib/billing\|CRON_SECRET\|POLICY_START\|GRACE_DAYS" src vercel.json
```

Expected: nothing.

```bash
grep -rn "bill_issued" src
```

Expected: exactly two hits — the type union and the notifications icon map.

- [ ] **Step 7: Build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: clean, and the `BillPayModal.tsx` `<img>` lint warning is now gone.

- [ ] **Step 8: Commit**

```bash
git add -A src vercel.json
git commit -m "Remove the monthly host commission billing system

The ledger existed only to bill back the 5% on host-QR bookings, where
the renter's whole payment went to the host's own wallet. With that
method gone the fee is collected at the point of sale, so there is
nothing to bill. host_bills and host_bill_items are empty (0 rows,
checked), so no record of money owed is lost.

The Vercel cron entry goes with it; CRON_SECRET must be removed from
the Vercel dashboard by hand."
```

---

### Task 4: Update reporting, account deletion and host terms

**Files:**
- Modify: `src/lib/admin-reports.ts`
- Modify: `src/app/admin/reports/page.tsx`
- Modify: `src/lib/account-deletion.ts`

> The host-terms edit that was here moved into Task 3 (ledger ruling 1): Task 3
> deletes `src/lib/billing.ts`, which host-terms imports, so its build gate
> fails unless that file is cleared in the same task.

**Interfaces:**
- Consumes: Task 3's removal of `src/lib/billing.ts`.
- Produces: `getCommissionSummary()` (or the existing equivalent) returning `{ earned, collected, uncollectable }` — the third field **renamed** from `uncollected`; `assertDeletable()` with two gates, not three.

- [ ] **Step 1: Rename the commission figure and drop the bill figures**

In `src/lib/admin-reports.ts`:
- delete whatever computes **Billed** and **Bill Payments** (they read `host_bills`);
- rename the `uncollected` field to `uncollectable`, keeping its computation unchanged (`host_qr` + `test_skip` service fees).

Update the doc comment to say plainly that this is now a fixed historical number: no new booking can be either method, so it cannot grow.

- [ ] **Step 2: Update the reports page**

In `src/app/admin/reports/page.tsx`, remove the Billed and Bill Payments columns and the "still owed" line derived from them. Relabel the remaining figure **"Uncollectable (legacy)"** and give it a caption:

```tsx
<p className="text-xs text-gray-400 mt-1">
  Commission earned on bookings paid outside Rentivo (direct host QR and
  pre-launch test bookings). No new booking can add to this.
</p>
```

Keep the CSV export working; rename its header to match.

- [ ] **Step 3: Remove the bills gate from account deletion**

In `src/lib/account-deletion.ts`:
- delete the third eligibility gate (any `issued` `host_bills` row) and its 400 message;
- delete `qr_payment_url` / `qr_payment_label` from the anonymise update;
- delete `payment-qr-codes` from the storage cleanup list.

Leave the in-flight-booking and pending-payout gates exactly as they are.

**This must ship before the migration.** The anonymise update names columns that Task 5 drops; leaving them here would make every account deletion fail.

- [ ] **Step 5: Verify**

```bash
grep -rn "uncollected\|Billed\|Bill Payments\|payment-qr-codes" src
```

Expected: nothing.

- [ ] **Step 6: Build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: clean.

- [ ] **Step 7: Commit and deploy the whole code change**

```bash
git add -A src
git commit -m "Update reports, account deletion and host terms for the billing removal

Uncollected becomes Uncollectable (legacy): after this change no new
booking can be host_qr or test_skip, so the figure is fixed history. A
label that outlives its meaning is the mistake Payouts Owed already
made here once.

Account deletion drops its third gate and stops naming the QR columns,
which the migration removes next."
git push origin main
npx vercel deploy --prod --yes
```

- [ ] **Step 8: Confirm production is serving the code before touching the database**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://rentivo.live/
curl -s -o /dev/null -w "%{http_code}\n" https://rentivo.live/dashboard/bills   # expect 404
curl -s https://rentivo.live/ | grep -c "rentivo-logo"                          # expect >0: storefront intact
```

Do not start Task 5 until `/dashboard/bills` returns 404 on production. That is the signal the deployed bundle no longer reads the objects the migration drops.

---

### Task 5: Migration — drop the database objects

**Files:**
- Create: `supabase/migrations/072_retire_host_qr_and_billing.sql`
- Create: `scripts/verify/072-retire-host-qr-and-billing.mjs`

**Interfaces:**
- Consumes: Tasks 1–4 deployed to production.
- Produces: trigger `block_host_qr_bookings` on `bookings`; no `host_bills`/`host_bill_items` tables; no `generate_host_bills`, `mark_host_bill_paid`, `void_host_bill`, `is_host_billing_delinquent`, `confirm_host_qr_payment`; no `profiles.qr_payment_url`/`qr_payment_label`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/072_retire_host_qr_and_billing.sql`:

```sql
-- Retire the host-QR payment method and the monthly commission billing.
--
-- QR Ph now works, so every payment runs through Rentivo's own PayMongo
-- account and the 5% service fee is collected at the point of sale. The
-- ledger existed only to bill that fee back on bookings the renter paid
-- straight into the host's wallet; with the method gone there is nothing
-- left to bill.
--
-- Deliberately NOT touched:
--   * the payment_method enum: two historical bookings reference 'host_qr',
--     and Postgres cannot drop a value rows still use;
--   * request_payout()'s exclusion of host_qr and test_skip bookings — the
--     host of RNT-02A59F already received that money directly, and the
--     booking can still reach 'completed';
--   * create_booking: enforcement reuses the trigger slot 061 created so
--     that function's body would never need copying again.

-- Guard: the ledger was empty when this was designed (0 bills, 0 items).
-- If that is no longer true, stop — bills represent money owed, and the
-- right response is to settle them, not to drop them.
do $$
declare
  v_bills integer;
begin
  select count(*) into v_bills from public.host_bills;
  if v_bills > 0 then
    raise exception 'host_bills has % row(s): settle or void them before retiring the ledger', v_bills;
  end if;
end $$;

-- 1. Block new host-QR bookings by replacing the delinquency trigger.
drop trigger if exists block_delinquent_host_qr on public.bookings;
drop function if exists public.block_delinquent_host_qr();

create or replace function public.block_host_qr_bookings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_method = 'host_qr' then
    raise exception 'Direct host QR payment is no longer offered. Please pay with QR Ph.';
  end if;
  return new;
end;
$$;

create trigger block_host_qr_bookings
  before insert on public.bookings
  for each row execute function public.block_host_qr_bookings();

-- 2. Functions before the tables they read.
drop function if exists public.generate_host_bills(date);
drop function if exists public.mark_host_bill_paid(uuid, text);
drop function if exists public.void_host_bill(uuid, text, boolean);
drop function if exists public.is_host_billing_delinquent(uuid);
drop function if exists public.confirm_host_qr_payment(uuid);

-- 3. Tables (host_bill_items has the FK, so it goes first).
drop table if exists public.host_bill_items;
drop table if exists public.host_bills;

-- 4. Personal data: the label held the host's real name and mobile number,
--    kept only to show renters who they were paying.
alter table public.profiles
  drop column if exists qr_payment_url,
  drop column if exists qr_payment_label;
```

- [ ] **Step 2: Apply it**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -5
```

Expected: `072` listed as applied. Ignore pg-delta certificate noise after "Applying migration…", per this repo's convention.

- [ ] **Step 3: Write the verification script**

Create `scripts/verify/072-retire-host-qr-and-billing.mjs`:

```js
// Proves the host-QR method and the billing ledger are gone, and — the
// check that matters most — that request_payout() still excludes host_qr
// bookings, so the host of a directly-paid booking is never paid twice.
//
// Usage: node --experimental-strip-types scripts/verify/072-retire-host-qr-and-billing.mjs
import { admin, asUser, signIn, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'

async function main() {
  const renter = await signIn('renter@demo.rentivo.ph', 'DemoRentivo1')

  // A real active listing to book against.
  const { body: listings } = await admin('listings?select=id,host_id&is_active=eq.true&is_draft=eq.false&limit=5')
  const listing = listings.find(l => l.host_id !== FORBIDDEN_HOST)
  check('found a listing to test against', Boolean(listing))

  // 1. The trigger refuses host_qr.
  const blocked = await asUser(renter, 'rpc/create_booking', {
    method: 'POST',
    body: JSON.stringify({
      p_listing_id: listing.id,
      p_pickup_date: '2026-11-10',
      p_return_date: '2026-11-12',
      p_payment_method: 'host_qr',
    }),
  })
  check('host_qr booking is refused', blocked.status >= 400,
    `HTTP ${blocked.status} ${JSON.stringify(blocked.body).slice(0, 160)}`)
  check('refusal names the replacement method',
    JSON.stringify(blocked.body).includes('QR Ph'))

  // CONTROL: the identical call with qrph succeeds, so the refusal above is
  // attributable to the method and not to some unrelated guard.
  const ok = await asUser(renter, 'rpc/create_booking', {
    method: 'POST',
    body: JSON.stringify({
      p_listing_id: listing.id,
      p_pickup_date: '2026-11-10',
      p_return_date: '2026-11-12',
      p_payment_method: 'qrph',
    }),
  })
  check('CONTROL: qrph booking is accepted', ok.status < 400,
    `HTTP ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`)
  const probeBookingId = ok.body?.id ?? ok.body
  if (probeBookingId) await admin(`bookings?id=eq.${probeBookingId}`, { method: 'DELETE' })

  // 2. The dropped RPCs are gone.
  for (const fn of ['generate_host_bills', 'mark_host_bill_paid', 'void_host_bill',
                    'is_host_billing_delinquent', 'confirm_host_qr_payment']) {
    const { status } = await admin(`rpc/${fn}`, { method: 'POST', body: '{}' })
    check(`${fn}() no longer exists`, status === 404, `HTTP ${status}`)
  }

  // 3. The tables are gone.
  for (const t of ['host_bills', 'host_bill_items']) {
    const { status } = await admin(`${t}?select=id&limit=1`)
    check(`${t} table is gone`, status === 404, `HTTP ${status}`)
  }

  // 4. The personal-data columns are gone.
  const { status: qrStatus } = await admin('profiles?select=qr_payment_label&limit=1')
  check('profiles.qr_payment_label is gone', qrStatus === 400, `HTTP ${qrStatus}`)

  // 5. THE IMPORTANT ONE: payout exclusion survives. The two historical
  //    host_qr bookings must never become payout-eligible.
  const { body: hostQr } = await admin(
    'bookings?select=id,booking_ref,payment_method,status,payment_status&payment_method=eq.host_qr')
  check('both historical host_qr bookings still exist', hostQr.length === 2, `found ${hostQr.length}`)
  const { body: items } = await admin(
    `payout_items?select=booking_id&booking_id=in.(${hostQr.map(b => b.id).join(',')})`)
  check('no host_qr booking is claimed by any payout', items.length === 0,
    `found ${items.length} payout item(s)`)

  // 6. Storefront intact: a missing grant would empty this silently.
  const { body: store, status: storeStatus } = await asUser(null,
    'listings?select=id,title,host:profiles!listings_host_id_fkey!inner(id,full_name)&is_active=eq.true&is_draft=eq.false')
  check('anon storefront read still works', storeStatus === 200, `HTTP ${storeStatus}`)
  check('storefront still returns listings', store.length > 0, `${store.length} listings`)

  done()
}

main()
```

- [ ] **Step 4: Run it**

```bash
node --experimental-strip-types scripts/verify/072-retire-host-qr-and-billing.mjs
```

Expected: `ALL CHECKS PASSED`. A failure on check 5 is a stop-everything signal — it means a host could be paid twice.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/072_retire_host_qr_and_billing.sql scripts/verify/072-retire-host-qr-and-billing.mjs
git commit -m "Drop the billing ledger and block new host-QR bookings

Guarded on host_bills being empty: bills are money owed, so a non-empty
ledger aborts the migration rather than being dropped silently.

New host-QR bookings are refused by a trigger that replaces the billing
delinquency trigger, so create_booking's body is not copied again."
```

---

### Task 6: Storage cleanup, docs, and final regression

**Files:**
- Create: `scripts/cleanup-payment-qr-bucket.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 5's applied migration.
- Produces: an empty, removed `payment-qr-codes` bucket; AGENTS.md describing the current system.

- [ ] **Step 1: Write the bucket cleanup script**

Create `scripts/cleanup-payment-qr-bucket.mjs`:

```js
// One-off: empty and remove the payment-qr-codes bucket. The host-QR
// feature is gone, so these images (a host's personal payment QR) have no
// remaining purpose and are personal data we no longer have a basis to keep.
//
// Usage: node --experimental-strip-types scripts/cleanup-payment-qr-bucket.mjs
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const H = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }

const list = await fetch(`${URL}/storage/v1/object/list/payment-qr-codes`, {
  method: 'POST', headers: H, body: JSON.stringify({ prefix: '', limit: 1000 }),
})
const files = await list.json()
console.log('objects found:', Array.isArray(files) ? files.length : JSON.stringify(files))

if (Array.isArray(files) && files.length > 0) {
  const names = files.map(f => f.name)
  const del = await fetch(`${URL}/storage/v1/object/payment-qr-codes`, {
    method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: names }),
  })
  console.log('delete objects:', del.status, (await del.text()).slice(0, 200))
}

const drop = await fetch(`${URL}/storage/v1/bucket/payment-qr-codes`, { method: 'DELETE', headers: H })
console.log('drop bucket:', drop.status, (await drop.text()).slice(0, 200))
```

- [ ] **Step 2: Run it and confirm**

```bash
node --experimental-strip-types scripts/cleanup-payment-qr-bucket.mjs
```

Expected: the bucket's objects deleted and the bucket removed. A 404 on the bucket delete means it was already gone — fine.

- [ ] **Step 3: Update AGENTS.md**

Two edits, both factual:
- In the architecture section, replace the **Host commission billing** bullet with one sentence recording that it existed, why, and that it was retired on 2026-09-13 when QR Ph activation made point-of-sale collection possible — pointing at this plan and its spec.
- In the **Host GCash/Maya QR payment** Status entry, append that the method was retired in the same change, that the two historical bookings remain, and that `request_payout()` still excludes them so those hosts are never paid twice.

Do not delete the old entries' reasoning; this file's value is the record of why things were done.

- [ ] **Step 4: Full regression**

```bash
npx tsc --noEmit && npm run lint && npm run build
node --experimental-strip-types scripts/verify/072-retire-host-qr-and-billing.mjs
node --experimental-strip-types scripts/verify/legal-pages.mjs https://rentivo.live
```

Expected: clean build, both scripts pass.

- [ ] **Step 5: Confirm the historical bookings still render**

With a real demo-host session (the forged-SSR-cookie pattern this repo documents), load:
- `/dashboard/bookings` — `RNT-02A59F` appears with a readable payment method
- `/book/complete?booking=a295bf41-715e-4aa5-9d18-ad58ce66b0a7` — the receipt renders, method named, no QR block, no error

This is the regression surface the spec calls out: the build passing proves nothing about these two rows.

- [ ] **Step 6: Commit and deploy**

```bash
git add -A
git commit -m "Clean up the QR bucket and record the billing removal in AGENTS.md"
git push origin main
npx vercel deploy --prod --yes
```

- [ ] **Step 7: Remove CRON_SECRET from Vercel by hand**

This cannot be scripted from here. In the Vercel dashboard, delete the `CRON_SECRET` production environment variable — the cron it authenticated no longer exists. Tell the user this step is outstanding if it hasn't been done.

---

## Self-Review

**Spec coverage:** §3.1 payment method → Tasks 1–2; §3.2 billing → Task 3 (code), Task 5 (database); §3.3 personal data → Task 2 (code), Task 5 (columns), Task 6 (bucket); §4.1 history kept → Global Constraints + Task 6 Step 5; §4.2 payout exclusions → Global Constraints + Task 5 check 5; §5 reporting → Task 4; §6 migration → Task 5; §7 verification → Task 5 script + Task 6 regression; §9 risks → Task 6 Steps 5 and 7.

**Placeholders:** none — every step carries its command, code, or exact identifier list.

**Type consistency:** `PROFILE_COLUMNS` (Task 2) is the same symbol Task 5's storefront check exercises. `block_host_qr_bookings` is named identically in the migration and the verification script. `uncollectable` (Task 4) is used in both the lib and the page.
