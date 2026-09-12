# Retire host-QR payment and the monthly commission billing — design

**Date:** 2026-09-13
**Status:** approved, not yet implemented
**Phase A of three** (A: this; B: admin-controlled service fee; C: admin-initiated payouts + statements)

## 1. Why now

The host-QR payment method let a renter pay the host's personal GCash/Maya QR
code directly. The whole payment — including Rentivo's 5% service fee — landed
in the host's wallet, so the fee was shown, computed, and never collected. The
monthly commission billing (migrations 061–063) exists solely to bill that fee
back afterwards, and its own documentation calls it "deliberately temporary,
for the period in which QR Ph is the only PayMongo method PayMongo has actually
activated".

QR Ph now works. Payments can go through Rentivo's own PayMongo account, where
the 5% is collected at the point of sale. The reason for both the direct-QR
method and the billing ledger is gone.

Removing the method is what makes the ledger removable. Keeping one without the
other would either leave commission uncollected (method without billing) or
leave a billing system with nothing to bill (ledger without method).

## 2. Live data this touches

Checked before designing:

| Thing | State |
|---|---|
| `host_bills` | **0 rows** |
| `host_bill_items` | **0 rows** |
| Profiles with a QR uploaded | 1 (the demo host; label is placeholder data) |
| `host_qr` bookings | 2, both demo: `RNT-75715D` (refunded, cancelled), `RNT-02A59F` (paid, confirmed) |

The empty ledger is what makes this safe. Retiring a billing system that held
real unpaid bills would destroy a record of money owed; there is none.

## 3. What is removed

### 3.1 The payment method

- The `host_qr` tile and all its checkout branches (`Step3Payment`, the
  "awaiting host confirmation" state in `BookingWizard` / `Step4Confirmation`).
- `GET /api/bookings/[id]/qr`, `POST /api/bookings/[id]/notify-qr-paid`,
  `POST /api/bookings/[id]/notify-qr-requested`.
- The host's "Mark Payment Received" action on `/dashboard/bookings` and the
  renter's "View Payment QR" on `/dashboard/rentals`.
- `QrPaymentCard` in Settings, and `useProfile`'s `uploadQrCode` / `removeQrCode`.
- `confirm_host_qr_payment()` — dropped; with no new `host_qr` bookings it can
  only ever act on the two historical rows, and both are settled.

### 3.2 The billing system

- Tables `host_bills`, `host_bill_items` (both empty) — dropped.
- RPCs `generate_host_bills`, `mark_host_bill_paid`, `void_host_bill`,
  `is_host_billing_delinquent` — dropped.
- Trigger `block_delinquent_host_qr` on `bookings` — **replaced**, see §4.2.
- Routes: `/api/cron/host-bills`, `/api/admin/bills/run`,
  `/api/admin/bills/[id]/void`, `/api/bills/[id]/pay`,
  `/api/bills/[id]/verify-payment`.
- Pages: `/dashboard/bills`, `/admin/bills`; components `BillPayModal`,
  `BillVoidAction`; hook `useHostBills`; `src/lib/billing.ts`.
- The `host_bills` branch in the PayMongo webhook.
- `notifyHostBillIssued` in `src/lib/email.ts`.
- The Vercel cron entry in `vercel.json` (and `CRON_SECRET` in Vercel, a manual
  dashboard step this spec cannot perform).
- The `issued host_bills` eligibility gate in `src/lib/account-deletion.ts`.
- The commission-billing section of `/host-terms`.

### 3.3 Personal data

`profiles.qr_payment_url` and `profiles.qr_payment_label` are dropped. The
label holds the host's real name and mobile number, kept only to show renters
who they were paying; with the feature gone there is no basis to keep it. The
`payment-qr-codes` storage bucket is emptied and dropped by a one-off script.

This removes them from `059`'s `grant select` list, `PROFILE_COLUMNS`,
`src/types/index.ts`, `mock-data.ts`, and the anonymise list in
`account-deletion.ts` — that module's standing obligation cuts both ways, and a
dropped column left in its update list would make every deletion fail.

## 4. What is deliberately kept

### 4.1 History stays readable

- The `payment_method` enum keeps `host_qr` and `test_skip`. Postgres cannot
  drop an enum value that rows still reference, and both historical bookings
  must keep rendering on dashboards and receipts.
- The two `host_qr` bookings are not modified.
- `Step4Confirmation`'s method label map keeps its `host_qr` entry, or the
  receipt for `RNT-02A59F` would render a blank payment method.
- The `bill_issued` notification type and its icon mapping stay. No row of that
  type was ever written, and removing the icon entry only risks a fallback
  crash for nothing.

### 4.2 The payout exclusions — load-bearing

`request_payout()` excludes `host_qr` and `test_skip` bookings (029, 033). Both
exclusions **stay**, and this is the single most important thing not to tidy
away: `RNT-02A59F` is paid and confirmed, so it can still reach `completed`.
Its host already received the renter's money directly. Paying it out again
would hand the host the same money twice, out of Rentivo's own funds.

The trigger slot that enforced billing delinquency is reused rather than
deleted: `block_delinquent_host_qr` becomes `block_host_qr_bookings`, which
rejects any insert with `payment_method = 'host_qr'`.

**This is why phase A does not touch `create_booking` at all.** Migration 061
established enforcement-by-trigger precisely so this function's body would not
have to be copied again, and two of this repo's documented security incidents
(038/039, 040) came from copying it. Phase B will have to copy it; phase A
should not, and keeping the two changes apart keeps that risk isolated.

## 5. Reporting

`/admin/reports` loses its **Billed** and **Bill Payments** columns.

The **Uncollected** figure stays but changes meaning, and the label must change
with it. It currently covers `host_qr` and `test_skip` bookings. After this
change no new booking can be either, so it becomes a fixed historical number —
commission earned on legacy bookings that can never be collected. It is
relabelled **"Uncollectable (legacy)"** with a caption saying so.

Getting this wrong has precedent here: "Payouts Owed" once implied money the
platform owed when it only counted what had been *requested*, and the fix was
to rename the column. A figure whose label outlives its meaning is the same
mistake.

## 6. Migration

One migration, in dependency order:

```sql
-- 1. Trigger first: nothing may create a new host_qr booking from here.
drop trigger if exists block_delinquent_host_qr on public.bookings;
drop function if exists public.block_delinquent_host_qr();
create function public.block_host_qr_bookings() returns trigger ...
  -- raises if new.payment_method = 'host_qr'
create trigger block_host_qr_bookings before insert on public.bookings ...

-- 2. RPCs that reference the tables, before the tables.
drop function if exists public.generate_host_bills(date);
drop function if exists public.mark_host_bill_paid(uuid, text);
drop function if exists public.void_host_bill(uuid, text, boolean);
drop function if exists public.is_host_billing_delinquent(uuid);
drop function if exists public.confirm_host_qr_payment(uuid);

-- 3. Tables (host_bill_items references host_bills).
drop table if exists public.host_bill_items;
drop table if exists public.host_bills;

-- 4. Personal data.
alter table public.profiles
  drop column if exists qr_payment_url,
  drop column if exists qr_payment_label;
```

A guard aborts the migration if `host_bills` is non-empty at apply time — the
ledger was empty when this was designed, and if that has changed, the right
response is to stop and settle the bills rather than drop them silently.

**Note:** dropping a column drops its column-level grants, which is fine here
(both columns are going), but `059`'s grant list in code comments and
`PROFILE_COLUMNS` must be updated to match or a later reader will be misled.

## 7. Verification

A script under `scripts/verify/`, following the established pattern — throwaway
accounts, real sessions for authorisation claims, service role only for setup
and independent re-reads.

1. **The new trigger** — `create_booking` with `p_payment_method => 'host_qr'`
   raises; the identical call with `'qrph'` succeeds (control).
2. **Payout exclusions intact** — a throwaway completed+paid `host_qr` booking
   is *not* included by `request_payout()`, while an equivalent `qrph` booking
   is (control). This is the check that matters most.
3. **History renders** — both historical `host_qr` bookings still load on the
   host dashboard, the renter's rentals page, and `/book/complete`, with a
   readable payment method.
4. **Dropped objects are gone** — the four RPCs and two tables raise/404 for the
   service role; `qr_payment_label` is gone from `profiles`.
5. **Account deletion still works** — the remaining two gates (in-flight
   booking, pending payout) still block, and a clean account still deletes,
   with no reference to the dropped columns.
6. **Storefront unaffected** — the `!inner` host embed still returns every
   active listing after `PROFILE_COLUMNS` changes.
7. **Build** — `tsc`, `lint`, `build` clean; no route references a deleted file.

## 8. Out of scope

- The admin-controlled service fee (phase B) and admin-initiated payouts with
  statements (phase C).
- Any change to how `qrph`, `gcash`, `maya` or `card` behave.
- Retro-collecting the ₱120 service fee on `RNT-02A59F`. It is demo data, and
  chasing it would mean building the very billing path this removes.

## 9. Risks

- **The two historical bookings are the whole regression surface.** Every
  removal must be checked against them rendering, not just against the build
  passing.
- **`CRON_SECRET` and the Vercel cron** are dashboard state, not code. The cron
  entry goes from `vercel.json`, but an orphaned env var will remain until
  someone removes it by hand.
- **Hosts who uploaded a QR lose it silently.** Only the demo host has one, so
  no real user is affected; if that changes before this ships, they should be
  told rather than have it vanish.
