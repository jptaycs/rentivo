# Legal Documents and Deposit Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Rentivo collecting security deposits it never returns, then ship the four legal documents the app already asks users to agree to.

**Architecture:** Two phases. Phase 1 changes what `create_booking` charges (migration 070, mirroring exactly what 035 did to `protection_fee`) and updates every place the deposit is displayed as a charge. Phase 2 writes `/terms`, `/privacy`, `/rental-agreement` and `/cancellation` as static server components in the shape `/host-terms` already uses, wires all twelve dead `href="#"` links, and deletes the cancellation and deposit claims the code does not implement.

**Tech Stack:** Next.js 16 App Router (React 19), Tailwind 4, hosted Supabase Postgres (migrations via `supabase db push --linked --yes`), verification via `scripts/verify/*.mjs` run with `node --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-09-08-legal-documents-and-deposits-design.md`

## Global Constraints

- **Contracting party:** Appnado IT Solutions, a DTI- and BIR-registered business. Rentivo is its product. Use this exact name in every document.
- **Contact address:** `jptayco1109@gmail.com` for support, privacy requests and legal notice. Never `support@rentivo.ph` — that domain has no MX records and is not Appnado's.
- **Documents describe what the code does.** Never write a policy the system does not implement. Where copy and code disagree, the copy is wrong.
- **Never claim these are lawyer-reviewed.** Each page carries a line saying it describes how Rentivo works and is not legal advice.
- **Migration order is load-bearing.** Migration 070 must be applied to the hosted database **before** the app changes deploy. The PayMongo charge is priced from the stored `booking.total_amount` (`src/app/api/payments/checkout/route.ts:156`), so migration-first means a renter is charged *less* than displayed during the window; app-first would charge them *more* than the page showed.
- **`create_booking` reproduction rule.** AGENTS.md records two security incidents (038/039, 040) caused by careless reproduction of this function. Task 1's diff against `045_suspension_visibility.sql` must contain **only** the two changes specified. Anything else is a defect.
- **This repo has no unit-test framework.** Verification is `scripts/verify/*.mjs` against the hosted database with throwaway accounts, plus `npx tsc --noEmit`, `npm run lint`, `npm run build`. Follow that pattern; do not introduce jest/vitest.
- **Never touch** host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` (Isse Capucao) or booking `RNT-A4DA55`. Probe accounts only, cleaned up after every run.
- **Accent colour rule:** `#FDF0D5` is never a text or icon colour on a light background.

---

# Phase 1 — Deposits

### Task 1: Migration 070 — stop charging the deposit

**Files:**
- Create: `supabase/migrations/070_drop_security_deposit_charge.sql`
- Create: `scripts/verify/070-deposit-not-charged.mjs`

**Interfaces:**
- Consumes: `create_booking` as defined in `045_suspension_visibility.sql:50-203`.
- Produces: `create_booking` with an identical signature, returning a `bookings` row whose `security_deposit` is `0` and whose `total_amount` excludes it. Task 2's client mirror must match this formula exactly.

- [ ] **Step 1: Write the failing verification script**

Create `scripts/verify/070-deposit-not-charged.mjs`:

```js
// Proves create_booking no longer charges the security deposit, and that
// already-charged bookings keep their historical amounts.
//
// Usage: node --experimental-strip-types scripts/verify/070-deposit-not-charged.mjs
import { URL as SUPABASE_URL, ANON, SECRET, admin, check, done } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const stamp = Date.now()
const created = { users: [], listings: [], bookings: [] }

async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json()
  if (!j.id) throw new Error('createUser: ' + JSON.stringify(j))
  created.users.push(j.id)
  return j.id
}
const hardDeleteUser = (id) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1' }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('signIn: ' + JSON.stringify(j))
  return j.access_token
}

async function main() {
  const { body: bookingsBefore } = await admin('bookings?select=id')

  const hostId = await createUser(`probe-dep-host-${stamp}@example.com`)
  await admin(`profiles?id=eq.${hostId}`, {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Probe Deposit Host', is_host: true, is_verified: true }),
  })
  const renterId = await createUser(`probe-dep-renter-${stamp}@example.com`)
  await admin(`profiles?id=eq.${renterId}`, {
    method: 'PATCH', body: JSON.stringify({ full_name: 'Probe Deposit Renter' }),
  })

  // Deliberately non-zero deposit and non-zero delivery fee: this listing can
  // tell "deposit excluded" apart from "everything except rental excluded".
  const { body: listingRows } = await admin('listings', {
    method: 'POST',
    body: JSON.stringify({
      host_id: hostId,
      title: `Probe Deposit Listing ${stamp}`,
      brand: 'Sony', model: 'A7 IV', category: 'mirrorless', condition: 'excellent',
      description: 'Probe listing for deposit-removal verification.',
      daily_price: 1000, security_deposit: 7000, delivery_fee: 350,
      city: 'Manila', province: 'Metro Manila',
      images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32'],
      is_active: true, is_draft: false,
      latitude: 14.5995, longitude: 120.9842, location_is_exact: true,
    }),
  })
  const listingId = listingRows[0].id
  created.listings.push(listingId)

  const token = await signIn(`probe-dep-renter-${stamp}@example.com`)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_listing_id: listingId,
      p_pickup_date: '2027-04-01', p_return_date: '2027-04-03',
      p_is_delivery: true, p_delivery_address: 'Probe address',
      p_payment_method: 'qrph', p_promo_code: null, p_renter_notes: null,
    }),
  })
  const b = await res.json()
  if (b?.id) created.bookings.push(b.id)
  check('booking created', res.status === 200 && Boolean(b?.id), JSON.stringify(b).slice(0, 200))

  // 2 days x P1000 = P2000 rental; 5% service = P100; delivery P350.
  check('rental_fee is 2000', b.rental_fee === 2000, String(b.rental_fee))
  check('service_fee is 100 (5% of rental only)', b.service_fee === 100, String(b.service_fee))
  check('delivery_fee is 350', b.delivery_fee === 350, String(b.delivery_fee))
  check('security_deposit stored as 0', b.security_deposit === 0, String(b.security_deposit))
  check('total_amount is 2450 (deposit NOT included)', b.total_amount === 2450, String(b.total_amount))
  check('total equals rental + service + delivery exactly',
    b.total_amount === b.rental_fee + b.service_fee + b.delivery_fee)
  check('listing still declares its deposit', listingRows[0].security_deposit === 7000)

  // Historical bookings must keep their real charged amounts.
  const { body: historical } = await admin(
    'bookings?select=booking_ref,security_deposit,total_amount&booking_ref=eq.RNT-89459E'
  )
  check('pre-070 booking keeps its historical deposit',
    historical?.[0]?.security_deposit === 10000, JSON.stringify(historical?.[0] ?? null))

  for (const x of created.bookings) await admin(`bookings?id=eq.${x}`, { method: 'DELETE' })
  for (const x of created.listings) await admin(`listings?id=eq.${x}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }

  const { body: bookingsAfter } = await admin('bookings?select=id')
  check('bookings count back at baseline', bookingsAfter.length === bookingsBefore.length,
    `${bookingsBefore.length} -> ${bookingsAfter.length}`)
  const { body: forbidden } = await admin(
    `bookings?booking_ref=eq.RNT-A4DA55&select=total_amount,host_id`)
  check('forbidden booking untouched',
    forbidden?.[0]?.total_amount === 1510 && forbidden?.[0]?.host_id === FORBIDDEN_HOST)
  done()
}

main().catch(async (err) => {
  console.error('\nSCRIPT ERROR:', err.message)
  for (const x of created.bookings) await admin(`bookings?id=eq.${x}`, { method: 'DELETE' })
  for (const x of created.listings) await admin(`listings?id=eq.${x}`, { method: 'DELETE' })
  for (const u of created.users) {
    await admin(`notifications?user_id=eq.${u}`, { method: 'DELETE' })
    await admin(`conversations?or=(renter_id.eq.${u},host_id.eq.${u})`, { method: 'DELETE' })
    await admin(`profiles?id=eq.${u}`, { method: 'DELETE' })
    await hardDeleteUser(u)
  }
  process.exit(1)
})
```

- [ ] **Step 2: Run it and confirm it fails on the deposit assertions**

Run: `node --experimental-strip-types scripts/verify/070-deposit-not-charged.mjs`

Expected: FAIL on `security_deposit stored as 0` (reports `7000`) and on `total_amount is 2450` (reports `9450`). Every other check passes. This is the proof the migration has something real to change.

- [ ] **Step 3: Generate the migration by copying 045's function verbatim**

```bash
sed -n '50,203p' supabase/migrations/045_suspension_visibility.sql \
  > /tmp/create_booking_045.sql
wc -l /tmp/create_booking_045.sql   # expect 154
```

Write `supabase/migrations/070_drop_security_deposit_charge.sql` with this header, then paste the extracted function body beneath it and apply the two edits in Step 4:

```sql
-- ============================================================
-- 070_drop_security_deposit_charge.sql
-- Rentivo stops charging the security deposit.
--
-- The deposit was added to total_amount and charged to the renter, but
-- request_payout() pays hosts rental_fee + delivery_fee only (046:105) and
-- NOTHING ever returned it — refundBooking() fires only on cancellation.
-- P32,600 across 5 paid bookings had accumulated in the PayMongo balance with
-- no path out. The deposit is now arranged directly between host and renter,
-- collected in person at pickup.
--
-- create_booking is reproduced VERBATIM from 045_suspension_visibility.sql
-- (the authoritative version) with exactly two changes, both below. AGENTS.md
-- records two security incidents caused by careless reproduction of this
-- function's body (038/039, 040) — diff this against 045 before applying.
--
-- bookings.security_deposit stays NOT NULL so the five already-charged
-- bookings keep their real amounts and their receipts still add up. This
-- mirrors exactly how 035 discontinued protection_fee.
-- listings.security_deposit stays too: the host still declares one, it is
-- shown on the listing, it is simply no longer charged through Rentivo.
-- ============================================================
```

- [ ] **Step 4: Apply the two edits, and only these two**

Edit 1 — the stored column, in the `values` list:

```sql
-- BEFORE
    v_rental, v_listing.security_deposit, v_service, v_protection, v_delivery,
-- AFTER
    -- 070: deposit is no longer charged; stored 0 like protection_fee (035).
    v_rental, 0, v_service, v_protection, v_delivery,
```

Edit 2 — the total:

```sql
-- BEFORE
    v_rental - v_discount + v_service + v_protection + v_delivery + v_listing.security_deposit,
-- AFTER
    v_rental - v_discount + v_service + v_protection + v_delivery,
```

- [ ] **Step 5: Diff against 045 and confirm only those two changes**

```bash
sed -n '50,203p' supabase/migrations/045_suspension_visibility.sql > /tmp/a.sql
awk '/^create or replace function public.create_booking\(/,/^\$\$;$/' \
  supabase/migrations/070_drop_security_deposit_charge.sql > /tmp/b.sql
diff /tmp/a.sql /tmp/b.sql
```

Expected: exactly two changed hunks, matching Step 4. **If the diff shows anything else, stop and fix it — do not apply.**

- [ ] **Step 6: Apply to the hosted database**

```bash
supabase db push --linked --yes
supabase migration list --linked | tail -3
```

Expected: `070` present in both local and remote. Ignore pg-delta cert noise after "Applying migration…".

- [ ] **Step 7: Re-run the verification script**

Run: `node --experimental-strip-types scripts/verify/070-deposit-not-charged.mjs`

Expected: `ALL CHECKS PASSED`, including `total_amount is 2450` and `pre-070 booking keeps its historical deposit`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/070_drop_security_deposit_charge.sql scripts/verify/070-deposit-not-charged.mjs
git commit -m "Stop charging the security deposit"
```

---

### Task 2: Client pricing mirror and the charged breakdowns

**Files:**
- Modify: `src/lib/pricing.ts:37`
- Modify: `src/components/booking/OrderSummary.tsx:100-103`
- Modify: `src/components/listings/BookingPanel.tsx:145-148`
- Modify: `src/components/booking/Step4Confirmation.tsx:195-198`

**Interfaces:**
- Consumes: Task 1's formula — `total = rental - discount + service + delivery`.
- Produces: `calcPricing()` returning a `total` that excludes the deposit. `PricedListing.security_deposit` stays in the interface: Task 3 renders it as a disclosure.

- [ ] **Step 1: Update the client mirror**

In `src/lib/pricing.ts`, replace the `calcPricing` doc comment and total line:

```ts
/**
 * Mirrors create_booking (070). The delivery fee is charged only when the
 * renter picks delivery, and the service fee is NOT charged on it — it is a
 * pass-through to the host.
 *
 * The security deposit is deliberately NOT part of the total: since 070
 * Rentivo does not charge it. The host collects it directly at pickup.
 * `PricedListing.security_deposit` stays on the interface because the listing
 * still discloses the amount — it is just not money Rentivo takes.
 */
export function calcPricing(listing: PricedListing, days: number, isDelivery = false) {
  const { rentalFee, tier } = calcRentalFee(listing, days)
  const serviceFee = Math.round(rentalFee * SERVICE_FEE_RATE)
  const deliveryFee = isDelivery ? (listing.delivery_fee ?? 0) : 0
  const total = rentalFee + serviceFee + deliveryFee
  return { rentalFee, tier, serviceFee, deliveryFee, total }
}
```

- [ ] **Step 2: Remove the deposit row from the checkout breakdown**

In `src/components/booking/OrderSummary.tsx`, delete these four lines (currently 100-103):

```tsx
        <div className="flex justify-between text-gray-600">
          <span>Security deposit <span className="text-xs">(refundable)</span></span>
          <span>₱{listing.security_deposit.toLocaleString()}</span>
        </div>
```

- [ ] **Step 3: Remove the deposit row from the listing booking panel**

In `src/components/listings/BookingPanel.tsx`, delete these four lines (currently 145-148):

```tsx
          <div className="flex justify-between text-gray-600">
            <span>Security deposit <span className="text-xs">(refundable)</span></span>
            <span>₱{listing.security_deposit.toLocaleString()}</span>
          </div>
```

- [ ] **Step 4: Make the receipt row conditional**

In `src/components/booking/Step4Confirmation.tsx`, replace lines 195-198:

```tsx
          {/* Pre-070 bookings really were charged a deposit; their receipts must
              still add up. New bookings store 0 and render no row. */}
          {booking.security_deposit > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Security deposit</span>
              <span>₱{booking.security_deposit.toLocaleString()}</span>
            </div>
          )}
```

- [ ] **Step 5: Verify the breakdown adds up in the browser**

```bash
npm run build && PORT=3100 npm start &
sleep 6
```

Open `http://localhost:3100/listings/<any active listing id>`, pick two dates. Confirm: the panel shows Rental, Service fee, Total, and **no** Security deposit row; Total equals rental + service fee exactly.

- [ ] **Step 6: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean (the pre-existing `BillPayModal` `<img>` warning is the only lint output).

- [ ] **Step 7: Commit**

```bash
git add src/lib/pricing.ts src/components/booking/OrderSummary.tsx \
  src/components/listings/BookingPanel.tsx src/components/booking/Step4Confirmation.tsx
git commit -m "Drop the deposit from every charged-total breakdown"
```

---

### Task 3: Reframe the deposit as a host disclosure

**Files:**
- Modify: `src/app/(main)/listings/[id]/page.tsx:115` and `:218-227`
- Modify: `src/components/booking/Step3Payment.tsx:459-463`
- Modify: `src/components/host/Step3Pricing.tsx:126-143`
- Modify: `src/app/(main)/dashboard/listings/[id]/edit/page.tsx` (deposit field helper text)

**Interfaces:**
- Consumes: nothing new.
- Produces: no exported symbols. Copy only.

- [ ] **Step 1: Fix the listing spec row**

In `src/app/(main)/listings/[id]/page.tsx` line 115, replace:

```tsx
                  { label: 'Security Deposit', value: `₱${listing.security_deposit.toLocaleString()}` },
```

with:

```tsx
                  { label: 'Security Deposit', value: `₱${listing.security_deposit.toLocaleString()} — paid to the host at pickup` },
```

- [ ] **Step 2: Fix the Trust & Safety card**

This card was added by commit `275c9d7` on 2026-09-08 and its wording becomes false under 070. In the same file, replace the deposit entry (currently 218-227):

```tsx
                  // Rentivo has no insurance or damage-claims mechanism, and
                  // since 070 does not collect the deposit either. Say exactly
                  // what happens: the host holds it, in person.
                  ...(listing.security_deposit > 0
                    ? [{
                        icon: Wallet,
                        title: 'Security Deposit',
                        desc: `₱${listing.security_deposit.toLocaleString()} arranged directly with the host at pickup — Rentivo does not collect or hold it`,
                      }]
                    : []),
```

- [ ] **Step 3: Fix the checkout consent sentence**

In `src/components/booking/Step3Payment.tsx`, replace the agreement paragraph (currently 459-463). The three `href="#"` values stay for now — Task 7 wires them:

```tsx
        <p className="text-sm text-gray-600 leading-relaxed">
          I agree to the{' '}
          <a href="#" className="text-[#003049] underline">Rental Agreement</a>,{' '}
          <a href="#" className="text-[#003049] underline">Terms of Service</a>, and{' '}
          <a href="#" className="text-[#003049] underline">Cancellation Policy</a>. I understand this host asks for a{' '}
          <strong>₱{listing.security_deposit.toLocaleString()}</strong> security deposit, arranged directly with them at pickup and not charged by Rentivo.
        </p>
```

- [ ] **Step 4: Fix the host wizard's deposit helper text**

In `src/components/host/Step3Pricing.tsx`, replace the helper line (currently 141-142):

```tsx
        <div className="flex items-start gap-2 mt-2 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          You collect this from the renter at pickup and return it yourself — Rentivo doesn&apos;t charge or hold it. Recommended: 3–5× the daily rate.
        </div>
```

- [ ] **Step 5: Add the same disclosure to the edit page**

`src/app/(main)/dashboard/listings/[id]/edit/page.tsx:351-359` has a bare label
and input with **no** helper text (neither do its neighbours), so add one.
Replace that block with:

```tsx
              <label className={label}>Security Deposit</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">₱</span>
                <input
                  type="number" value={deposit} onChange={e => setDeposit(e.target.value)}
                  className={`${field} pl-8`}
                />
              </div>
              <p className="mt-2 text-xs text-gray-400">
                You collect this from the renter at pickup and return it yourself — Rentivo doesn&apos;t charge or hold it.
              </p>
            </div>
```

Note this block ends with the field's closing `</div>`; keep it, or the grid breaks.

- [ ] **Step 6: Verify in the browser**

With a production build on port 3100, check a listing page shows the spec row reading "paid to the host at pickup" and the Trust & Safety card reading "arranged directly with the host at pickup". Confirm no page anywhere still says "collected at checkout" or "refundable upon return":

```bash
for p in / /search "/listings/<id>"; do
  curl -s "http://localhost:3100$p" | grep -ci "collected at checkout\|refundable upon return"
done
```
Expected: `0` for every page.

- [ ] **Step 7: Typecheck, lint, build, then commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add -A && git commit -m "Present the deposit as a host arrangement, not a Rentivo charge"
```

---

# Phase 2 — Documents

### Task 4: `/privacy`

**Files:**
- Create: `src/app/(main)/privacy/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: route `/privacy`. Tasks 7 and 8 link to it.

- [ ] **Step 1: Create the page using `/host-terms`'s established shape**

Read `src/app/(main)/host-terms/page.tsx` first and match its container, heading and spacing classes exactly. Scaffold:

```tsx
export const metadata = { title: 'Privacy Policy — Rentivo' }

export default function PrivacyPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Privacy Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 8, 2026</p>
        </div>
        {/* sections below */}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the required sections**

Every item below must appear. Do not add categories the app does not collect.

1. **Who we are.** Appnado IT Solutions, a DTI- and BIR-registered business, operating Rentivo. Contact `jptayco1109@gmail.com`. Personal Information Controller under RA 10173.
2. **What we collect.** Account: name, email, avatar, bio, city. **Identity verification: a government-issued ID and a selfie — sensitive personal information under RA 10173 §3(l)**, stored in a private bucket. Listings: photos, serial numbers, street address, exact pickup coordinates. Bookings: dates, amounts, delivery addresses. Messages and message images. Payout details: bank or e-wallet account number and name. Host QR payment labels, which contain the host's real name and mobile number. Wishlist and recently-viewed history.
3. **Why.** Operating the marketplace, verifying identity so renters can trust hosts, processing payments, sending transactional email, and fraud/abuse prevention.
4. **Who else processes it.** Supabase (database, authentication, file storage), Vercel (hosting), PayMongo (payments), Resend (transactional email), Google (only if you sign in with Google), Esri (map tiles — your browser fetches these, so Esri sees your IP address). Some process data outside the Philippines.
5. **What stays on your device.** State plainly: the face check on ID and selfie uploads runs **entirely in your browser** — the image is never sent anywhere for analysis — and the detection library's telemetry endpoint is blocked by the site's Content-Security-Policy.
6. **Retention and deletion.** Deleting your account **anonymizes** your profile rather than erasing it, because bookings, reviews and messages reference it and erasing it would destroy the other party's records of their own rentals. Deleted: verification documents, notifications, wishlist, recently-viewed. Kept: financial records (commission bills, payout requests) and message threads, as the other party's history.
7. **Your rights under the Data Privacy Act.** To be informed; access; correct; erasure or blocking; object; damages; data portability; and to complain to the National Privacy Commission. Say how to exercise them: email the contact address.
8. **Cookies.** Only what the app sets: an authentication session cookie and preference storage. No advertising or third-party tracking cookies.
9. **Changes**, and a closing line: this describes how Rentivo actually works and is not legal advice.

- [ ] **Step 3: Verify it renders**

```bash
npm run build && PORT=3100 npm start &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/privacy
```
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(main\)/privacy/page.tsx
git commit -m "Add the privacy policy"
```

---

### Task 5: `/terms`

**Files:**
- Create: `src/app/(main)/terms/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: route `/terms`.

- [ ] **Step 1: Create the page**

Same scaffold as Task 4 Step 1, with `metadata = { title: 'Terms of Service — Rentivo' }`, heading "Terms of Service", and the same "Last updated September 8, 2026" line.

- [ ] **Step 2: Write the required sections**

1. **Who you are contracting with.** Appnado IT Solutions, operating Rentivo.
2. **What Rentivo is.** State it flatly, because everything else depends on it: *Rentivo is a venue that connects equipment owners with renters. Rentivo is not a party to any rental. It does not own, inspect, insure or guarantee any equipment listed, and it operates no damage-claims process.*
3. **Eligibility.** 18 or older; accurate information; one account per person.
4. **What may be listed.** Cameras, lenses and smartphones only. No drones, laptops, consoles or vehicles.
5. **Host verification.** A government ID and selfie are reviewed before listings are published. Listings stay hidden until then.
6. **Fees.** A 5% service fee on the rental amount only. Delivery fees are set by the host and passed to them in full. Security deposits are arranged between host and renter and are not charged by Rentivo. Hosts paid by direct GCash/Maya QR are billed the 5% monthly — link to `/host-terms`.
7. **Suspension and termination.** This clause does not exist today while `/admin` already exercises it, so state it: Rentivo may suspend or remove an account for breach of these terms, misrepresentation, fraud, off-platform payment circumvention, or unpaid amounts; a suspended host's listings are hidden and payouts stop; accounts with an in-flight booking, a pending payout or an unpaid bill cannot be deleted until those are resolved.
8. **Prohibited conduct.** Circumventing Rentivo to avoid fees, misrepresenting equipment, sub-renting, harassment.
9. **Limitation of liability**, to the extent Philippine law allows.
10. **Governing law:** the Philippines.
11. **Changes**, and the same not-legal-advice line.

- [ ] **Step 3: Verify and commit**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/terms   # expect 200
git add src/app/\(main\)/terms/page.tsx && git commit -m "Add the terms of service"
```

---

### Task 6: `/rental-agreement` and `/cancellation`

**Files:**
- Create: `src/app/(main)/rental-agreement/page.tsx`
- Create: `src/app/(main)/cancellation/page.tsx`

**Interfaces:**
- Consumes: Task 1's behaviour (deposits not charged) and the real cancellation behaviour below.
- Produces: routes `/rental-agreement` and `/cancellation`.

- [ ] **Step 1: Write `/rental-agreement`**

Same scaffold. Required content:

1. This is an agreement **between the host and the renter**. Rentivo is not a party and provides no insurance.
2. Pickup: a valid government ID is required at handover.
3. Condition: the renter returns the equipment in the same condition, with all included accessories.
4. Late return: charged at 1.5× the daily rate per day, payable to the host.
5. No sub-renting or transferring to any third party.
6. **Security deposit:** the amount shown on the listing is agreed and settled **directly between host and renter at pickup and return. Rentivo does not charge, hold or return it.**
7. **Loss and damage:** the renter is responsible. Settled between host and renter; Rentivo has no claims process and cannot adjudicate. Keep it in the booking's message thread so there is a record.
8. The not-legal-advice line.

- [ ] **Step 2: Write `/cancellation` — matching what the code actually does**

The app currently states two policies it does not implement. The truth, from the code:

- A renter can cancel only while the booking is still **pending** — before the host accepts.
- A paid cancellation is refunded **in full** (`refundBooking()` refunds `total_amount`, with no time-based penalty).
- A host may decline a pending request; the renter is refunded in full.
- **There are no Flexible / Moderate / Strict tiers** — no such column exists.
- A refund is returned to the original payment method by PayMongo and may take several banking days.
- Bookings paid by direct GCash/Maya QR to a host are **not** refundable through Rentivo, because Rentivo never received that money — arrange it with the host.

Required content is exactly those six points, plus the not-legal-advice line.

- [ ] **Step 3: Verify and commit**

```bash
for p in /rental-agreement /cancellation; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:3100$p"
done   # expect 200 for both
git add src/app/\(main\)/rental-agreement src/app/\(main\)/cancellation
git commit -m "Add the rental agreement and cancellation policy"
```

---

### Task 7: Wire every dead link and delete the false claims

**Files:**
- Modify: `src/components/auth/SignupForm.tsx:237,239`
- Modify: `src/components/booking/Step3Payment.tsx:460-462`
- Modify: `src/app/(main)/dashboard/settings/page.tsx:389,395` and `:75,77`
- Modify: `src/components/layout/Footer.tsx:37,47-49`
- Modify: `src/components/booking/Step1Review.tsx:67-73`
- Modify: `src/app/not-found.tsx:37`

**Interfaces:**
- Consumes: routes `/terms`, `/privacy`, `/rental-agreement`, `/cancellation` from Tasks 4-6.
- Produces: no `href="#"` in any consent or legal surface.

- [ ] **Step 1: Signup consent**

`SignupForm.tsx`: `<Link href="#">Terms of Service</Link>` → `href="/terms"`; Privacy Policy → `href="/privacy"`.

- [ ] **Step 2: Checkout consent**

`Step3Payment.tsx`: Rental Agreement → `/rental-agreement`; Terms of Service → `/terms`; Cancellation Policy → `/cancellation`.

- [ ] **Step 3: Settings links and the deposit FAQ**

`settings/page.tsx`: the two `href="#"` buttons → `/terms` and `/privacy`. Replace `href="mailto:support@rentivo.ph"` (both occurrences, lines 383 and 456) with `mailto:jptayco1109@gmail.com`, preserving the `?subject=` on the deletion one.

Replace the cancellation FAQ (line 77), which describes tiers that do not exist:

```tsx
    { q: 'Can I cancel a booking?', a: 'You can cancel while a booking is still pending — before the host accepts it — and a paid booking is refunded in full. Once a host accepts, contact them through the booking\'s message thread. Bookings paid directly to a host\'s GCash or Maya QR are settled with that host, since Rentivo never received the money.' },
```

- [ ] **Step 4: Footer**

`Footer.tsx`: Privacy → `/privacy`, Terms → `/terms`, Cookies → `/privacy`. The Support column's four items are currently one `.map()` over strings with a shared `href="#"`; convert to an array of `{ label, href }`:

```tsx
              {[
                { label: 'Help Center', href: 'mailto:jptayco1109@gmail.com' },
                { label: 'Safety', href: '/rental-agreement' },
                { label: 'Cancellations', href: '/cancellation' },
                { label: 'Contact Us', href: 'mailto:jptayco1109@gmail.com' },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
```

- [ ] **Step 5: Delete the fictional 48-hour rule**

`Step1Review.tsx`, replace the Cancellation Policy block (67-73). The 48h/50%/no-show rule is implemented nowhere:

```tsx
      {/* Cancellation policy */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-bold text-[#111827] mb-2">Cancellation Policy</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          Cancel any time before the host accepts your request and you&apos;ll be refunded in full.{' '}
          <Link href="/cancellation" className="text-[#003049] underline">Read the full policy</Link>.
        </p>
      </div>
```

Add `import Link from 'next/link'` if absent.

- [ ] **Step 6: not-found page**

`not-found.tsx:37`: `mailto:support@rentivo.ph` → `mailto:jptayco1109@gmail.com`.

- [ ] **Step 7: Confirm nothing was missed**

```bash
grep -rn 'href="#"' src --include='*.tsx'
grep -rn "support@rentivo.ph" src
```
Expected: no output from either.

- [ ] **Step 8: Typecheck, lint, build, commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add -A && git commit -m "Wire every legal link and delete the policies the code never implemented"
```

---

### Task 8: Whole-feature verification

**Files:**
- Create: `scripts/verify/legal-pages.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: a repeatable regression check.

- [ ] **Step 1: Write the script**

```js
// Proves the four legal documents exist and that no surface still links to
// nothing or states a policy the code does not implement.
//
// Usage: node --experimental-strip-types scripts/verify/legal-pages.mjs [appUrl]
import { check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const PAGES = ['/terms', '/privacy', '/rental-agreement', '/cancellation', '/host-terms']

// Claims the app must no longer make anywhere.
const FORBIDDEN = [
  '48 hours',
  'Flexible, Moderate, or Strict',
  'refundable upon return',
  'collected at checkout',
  'Equipment Protection',
  'accidental damage',
  'support@rentivo.ph',
]

const get = async (p) => {
  const res = await fetch(`${APP}${p}`)
  return { status: res.status, html: await res.text() }
}

async function main() {
  for (const p of PAGES) {
    const { status, html } = await get(p)
    check(`${p} returns 200`, status === 200, `HTTP ${status}`)
    check(`${p} names Appnado IT Solutions`, html.includes('Appnado IT Solutions'))
    check(`${p} carries the contact address`, html.includes('jptayco1109@gmail.com'))
  }

  // The privacy notice must actually mention the sensitive data it collects.
  const { html: privacy } = await get('/privacy')
  for (const term of ['government', 'selfie', 'National Privacy Commission', 'Supabase', 'PayMongo']) {
    check(`/privacy mentions ${term}`, privacy.toLowerCase().includes(term.toLowerCase()))
  }

  // Terms must carry the venue disclaimer and the suspension clause.
  const { html: terms } = await get('/terms')
  check('/terms says Rentivo is not a party to rentals', /not a party/i.test(terms))
  check('/terms carries a suspension clause', /suspend/i.test(terms))

  // Cancellation must describe the real behaviour, not tiers.
  const { html: cancel } = await get('/cancellation')
  check('/cancellation says refunded in full', /in full/i.test(cancel))
  check('/cancellation does NOT describe tiers', !/Flexible/i.test(cancel))

  // No public page may carry a forbidden claim or a dead link.
  const PUBLIC = ['/', '/search', '/login', '/signup', ...PAGES]
  for (const p of PUBLIC) {
    const { html } = await get(p)
    check(`${p} has no href="#"`, !html.includes('href="#"'))
    for (const claim of FORBIDDEN) {
      check(`${p} does not say "${claim}"`, !html.includes(claim))
    }
  }
  done()
}

main()
```

- [ ] **Step 2: Run it against a production build**

```bash
npm run build && PORT=3100 npm start &
sleep 6
node --experimental-strip-types scripts/verify/legal-pages.mjs
```
Expected: `ALL CHECKS PASSED`.

**If `/` reports a forbidden claim,** it is a real miss — find and fix the source rather than removing the assertion.

- [ ] **Step 3: Re-run the deposit script to confirm no regression**

```bash
node --experimental-strip-types scripts/verify/070-deposit-not-charged.mjs
```
Expected: `ALL CHECKS PASSED`.

- [ ] **Step 4: Check the signed-in consent surfaces**

`/dashboard/settings` and `/book` need a session. Using this repo's forged-cookie pattern (AGENTS.md, "E2E test pattern"), sign in the demo renter and confirm `/dashboard/settings` returns 200 with no `href="#"` and no `support@rentivo.ph`.

- [ ] **Step 5: Stop the server and commit**

```bash
kill $(lsof -t -iTCP:3100 -sTCP:LISTEN)
git add scripts/verify/legal-pages.mjs
git commit -m "Add legal-pages regression verification"
```

- [ ] **Step 6: Update AGENTS.md**

Add a Status entry recording: migration 070 and why (the ₱32,600 with no return path, all Demo Renter, nothing owed); that deposits are now a host arrangement and the trade-off accepted; the four documents and the contracting entity; that `support@rentivo.ph` is dead and must not be reintroduced; and the gaps from spec §7 — not lawyer-reviewed, the held balance untouched, RA 11967 and NPC/DPO registration out of scope. Correct the two stale baselines this workstream found: `RNT-A4DA55` is `confirmed` (since 2026-09-02), not pending, and `admin_actions` holds 1 real row, not 0.

```bash
git add AGENTS.md && git commit -m "Record the deposit removal and legal documents"
```

---

## Deployment note

Migration 070 is applied to the hosted database in Task 1 Step 6, which affects production immediately while the deployed app still displays the deposit. That window charges renters **less** than shown — the safe direction, and the reason for this ordering. Deploy promptly after Task 8 so display and charge agree again. Pushing to `main` auto-deploys via the Vercel Git integration; a manual `vercel deploy --prod --yes` is redundant.
