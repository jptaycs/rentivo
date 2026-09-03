# Host Commission Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bill hosts monthly for the 5% service fee on host-QR bookings, let them pay in-app via QR Ph, and withhold the direct-QR checkout option while a bill is overdue.

**Architecture:** A `host_bills` / `host_bill_items` ledger written only by three service-role RPCs (generate / mark paid / void), an anon-callable `is_host_billing_delinquent()` helper consulted by a `before insert` trigger on `bookings` and by the checkout tiles, a cron + admin route that generates bills, a pay route that creates a QR Ph intent whose id the existing PayMongo webhook matches back to the bill, and two pages (host `/dashboard/bills`, admin `/admin/bills`). Every piece mirrors an existing pattern in this repo (payouts migration 020, suspension helper 046, notification RPC 043, checkout/webhook routes, admin API routes).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres, RLS, security-definer RPCs, `@supabase/ssr`), PayMongo QR Ph, Resend, Vercel cron, Node verification scripts under `scripts/verify/` (no test framework in this repo — the scripts ARE the tests, run against the hosted database with real sessions).

**Spec:** `docs/superpowers/specs/2026-09-04-host-commission-billing-design.md`

## Global Constraints

- Every new table gets `alter table ... enable row level security` in the same migration that creates it (AGENTS.md ⚠️ 016/017: a table without RLS is world-writable in this project regardless of grants).
- No client write grants on the new tables; all transitions are `security definer` RPCs granted to `service_role` only, except `is_host_billing_delinquent` (anon + authenticated).
- Never edit `create_booking`'s body. Enforcement is a trigger on `bookings`.
- `POLICY_START = '2026-09-05 00:00+08'` (midnight Manila, 2026-09-05). Grace period 14 days. Both live in exactly two places: the migration and `src/lib/billing.ts`.
- New enum value (`bill_issued`) goes in its own migration file (062); nothing in that file may use the value.
- Migrations are applied with `supabase db push --linked --yes` and confirmed with `supabase migration list --linked`. This pushes to the ONE hosted project (there is no staging); every migration must be replay-safe (`create or replace`, `drop ... if exists`, `if not exists`).
- Verification scripts: real signed-in sessions (`asUser`/`signIn` from `scripts/verify/env.mjs`) for every authorisation claim; `admin()` only for setup, independent re-reads, cleanup. Every probe row deleted; table counts asserted identical before/after; never touch host `c38111b3-9922-4d18-9ae9-a12c8ffb9c68` or booking `RNT-A4DA55`; never the demo accounts as *subjects* of destructive probes (throwaway accounts only).
- Copy rule: never use the cream accent `#FDF0D5` as text/icon colour on a light background. Amber = informational, red = error/overdue, green = paid.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` must be clean at the end of every task.
- Commit per task, message in the imperative, ending with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NJfRAHnuXKEQocsyWz2Usw
  ```
- Dev server for route checks runs on **port 3100** (`npm run dev -- -p 3100`); port 3000 belongs to another project. Kill by PID from `lsof -t -iTCP:3100 -sTCP:LISTEN` before restarting.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/061_host_bills.sql` | enum, two tables, RLS, grants, `generate_host_bills`, `mark_host_bill_paid`, `void_host_bill`, `is_host_billing_delinquent`, the bookings trigger |
| `supabase/migrations/062_bill_notification_type.sql` | `bill_issued` enum value only |
| `supabase/migrations/063_host_bills_notify.sql` | `generate_host_bills` redefined with the notification insert |
| `src/lib/billing.ts` | `POLICY_START`, `GRACE_DAYS`, `previousPeriod()`, `periodLabel()`, `HostBill` types |
| `src/lib/email.ts` (modify) | `notifyHostBillIssued(billId)` |
| `src/app/api/cron/host-bills/route.ts` | cron entry: generate previous month, email each |
| `src/app/api/admin/bills/run/route.ts` | admin "Run now" |
| `src/app/api/admin/bills/[id]/void/route.ts` | admin void |
| `src/app/api/bills/[id]/pay/route.ts` | host: create QR Ph intent for a bill |
| `src/app/api/bills/[id]/verify-payment/route.ts` | host: ask PayMongo directly, mark paid |
| `src/app/api/webhooks/paymongo/route.ts` (modify) | bill branch after the booking branch |
| `src/components/booking/Step3Payment.tsx` (modify) | hide host-QR tile when delinquent |
| `src/lib/account-deletion.ts` (modify) + both delete routes + admin user page | third gate: issued bills |
| `src/hooks/useHostBills.ts` | own bills + items, `pay()`, `verify()` |
| `src/app/(main)/dashboard/bills/page.tsx` | host Bills page |
| `src/components/dashboard/DashboardSidebar.tsx` (modify) | Bills nav item |
| `src/app/admin/bills/page.tsx`, `src/components/admin/BillRunForm.tsx`, `src/components/admin/BillVoidAction.tsx` | admin Bills page |
| `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/lib/admin-reports.ts`, `src/app/admin/reports/page.tsx` (modify) | nav, overdue card, Billed figures |
| `src/app/(main)/host-terms/page.tsx` | policy page |
| `src/components/host/Step6Verify.tsx`, `src/components/shared/QrPaymentCard.tsx` (modify) | links/notice |
| `src/types/index.ts` (modify) | `Notification['type']` gains `bill_issued`; `HostBill`, `HostBillItem` |
| `src/app/(main)/dashboard/notifications/page.tsx` (modify) | ICONS entry |
| `vercel.json` | cron schedule |
| `scripts/verify/061-host-bills.mjs` | the database-level test script (grown across Tasks 1, 2, 6) |
| `scripts/verify/064-bill-routes.mjs` | the HTTP-route test script (Tasks 3, 4) |
| `AGENTS.md` (modify) | Status entry, repo map, architecture bullet, deletion obligation, To Do |

---

### Task 1: Migration 061 — ledger, RPCs, helper, trigger

**Files:**
- Create: `supabase/migrations/061_host_bills.sql`
- Create: `scripts/verify/061-host-bills.mjs`

**Interfaces:**
- Consumes: `public.profiles`, `public.bookings` (`payment_method`, `payment_status`, `status`, `paid_at`, `service_fee`, `host_id`), `public.is_host_suspended` pattern (046), `scripts/verify/env.mjs` (`URL`, `ANON`, `SECRET`, `admin`, `asUser`, `signIn`).
- Produces: enum `host_bill_status ('issued','paid','void')`; tables `host_bills`, `host_bill_items`; RPCs `generate_host_bills(p_period date) returns setof host_bills`, `mark_host_bill_paid(p_bill_id uuid, p_paymongo_ref text) returns host_bills`, `void_host_bill(p_bill_id uuid, p_reason text) returns host_bills`, `is_host_billing_delinquent(p_host_id uuid) returns boolean`; trigger `bookings_block_delinquent_host_qr`.

- [ ] **Step 1: Write the failing verification script**

Create `scripts/verify/061-host-bills.mjs`. It seeds a throwaway host/renter/listing, four host-QR bookings in different states, and asserts the RPCs. Setup uses the real `create_booking` and `confirm_host_qr_payment` RPCs (as the real sessions), then patches `paid_at` with admin to place bookings in time.

```js
// Verifies migration 061 (host commission billing ledger) against the hosted
// database. Real sessions for every authorisation claim; admin only for
// setup, independent re-reads and cleanup. Throwaway accounts only.
import { URL as SUPABASE_URL, ANON, SECRET, admin, asUser, signIn } from './env.mjs'

const FORBIDDEN_HOST = 'c38111b3-9922-4d18-9ae9-a12c8ffb9c68'
const POLICY_START = '2026-09-05T00:00:00+08:00'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }
const rpc = async (tok, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: tok === SECRET ? SECRET : ANON, Authorization: `Bearer ${tok ?? ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const sub = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sub
const denied = (r) => r.status === 401 || r.status === 403 || /permission denied/.test(JSON.stringify(r.body))

// ── throwaway accounts (auth admin API) ──
async function createUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProbeRentivo1', email_confirm: true }),
  })
  const j = await res.json(); if (!j.id) throw new Error('createUser: ' + JSON.stringify(j)); return j.id
}
async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` } })
}

const stamp = Date.now()
const hostEmail = `probe-bill-host-${stamp}@example.com`, renterEmail = `probe-bill-renter-${stamp}@example.com`
const baseline = async () => ({
  bills: (await admin('host_bills?select=id')).body.length,
  items: (await admin('host_bill_items?select=id')).body.length,
  bookings: (await admin('bookings?select=id')).body.length,
  notifications: (await admin('notifications?select=id')).body.length,
})
const before = await baseline()
const hostId = await createUser(hostEmail), renterId = await createUser(renterEmail)
let listingId = null
const bookingIds = []
try {
  // handle_new_user created profiles; make the host a verified host with a QR so host_qr is allowed.
  await admin(`profiles?id=eq.${hostId}`, { method: 'PATCH', body: JSON.stringify({ is_host: true, is_verified: true, full_name: 'Probe Bill Host', qr_payment_url: `${hostId}/probe.png`, qr_payment_label: 'GCash — Probe' }) })
  await admin(`profiles?id=eq.${renterId}`, { method: 'PATCH', body: JSON.stringify({ full_name: 'Probe Bill Renter' }) })
  const { body: [listing] } = await admin('listings', { method: 'POST', body: JSON.stringify({
    host_id: hostId, category: 'mirrorless', brand: 'Probe', model: 'B1', title: 'Probe billing listing', description: 'probe', condition: 'good',
    daily_price: 1000, security_deposit: 0, city: 'Manila', province: 'Metro Manila', is_instant_book: false, is_active: true, is_draft: false, images: [], accessories: [],
  }) })
  listingId = listing.id
  const hostTok = await signIn(hostEmail, 'ProbeRentivo1'), renterTok = await signIn(renterEmail, 'ProbeRentivo1')

  // Four host_qr bookings, distinct date ranges so availability never collides.
  const mk = async (from, to) => {
    const r = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: from, p_return_date: to, p_is_delivery: false, p_delivery_address: null, p_payment_method: 'host_qr', p_promo_code: null })
    if (r.status !== 200) throw new Error('create_booking: ' + JSON.stringify(r.body))
    bookingIds.push(r.body.id); return r.body
  }
  const bInPeriod = await mk('2027-01-10', '2027-01-12')   // paid inside the probe period
  const bLate = await mk('2027-02-10', '2027-02-12')       // paid after the probe period
  const bCancelled = await mk('2027-03-10', '2027-03-12')  // paid, then cancelled
  const bPrePolicy = await mk('2027-04-10', '2027-04-12')  // paid before POLICY_START
  for (const b of [bInPeriod, bLate, bCancelled, bPrePolicy]) {
    const r = await rpc(hostTok, 'confirm_host_qr_payment', { p_booking_id: b.id })
    if (r.status !== 200) throw new Error('confirm_host_qr_payment: ' + JSON.stringify(r.body))
  }
  // Probe period: 2030-01 (far future so no real booking can ever collide).
  const PERIOD = '2030-01-01'
  await admin(`bookings?id=eq.${bInPeriod.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2030-01-15T10:00:00+08:00' }) })
  await admin(`bookings?id=eq.${bLate.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2030-02-03T10:00:00+08:00' }) })
  await admin(`bookings?id=eq.${bCancelled.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2030-01-20T10:00:00+08:00', status: 'cancelled' }) })
  await admin(`bookings?id=eq.${bPrePolicy.id}`, { method: 'PATCH', body: JSON.stringify({ paid_at: '2026-09-01T10:00:00+08:00' }) })
  const feeOf = async (id) => (await admin(`bookings?select=service_fee&id=eq.${id}`)).body[0].service_fee

  // ── generate: once, then again ──
  const g1 = await rpc(SECRET, 'generate_host_bills', { p_period: PERIOD })
  check('generate #1 -> 200 with one bill', g1.status === 200 && Array.isArray(g1.body) && g1.body.length === 1, `${g1.status} ${JSON.stringify(g1.body).slice(0, 120)}`)
  const bill = g1.body[0]
  check('bill belongs to the probe host, period, status issued', bill?.host_id === hostId && bill?.period === PERIOD && bill?.status === 'issued')
  check('bill amount = in-period booking service_fee', bill?.amount === await feeOf(bInPeriod.id), `${bill?.amount}`)
  check('due_at ≈ issued_at + 14 days', Math.abs(new Date(bill.due_at) - new Date(bill.issued_at) - 14 * 864e5) < 60e3)
  const { body: items1 } = await admin(`host_bill_items?select=booking_id,amount&bill_id=eq.${bill.id}`)
  check('exactly one item, the in-period booking', items1.length === 1 && items1[0].booking_id === bInPeriod.id)
  const g2 = await rpc(SECRET, 'generate_host_bills', { p_period: PERIOD })
  check('generate #2 is a no-op (returns zero bills)', g2.status === 200 && g2.body.length === 0, `${JSON.stringify(g2.body).slice(0, 80)}`)
  const { body: billsNow } = await admin(`host_bills?select=id&host_id=eq.${hostId}`)
  check('still exactly one bill for the host', billsNow.length === 1)

  // ── next period picks up the late-paid booking, never re-bills the first ──
  const g3 = await rpc(SECRET, 'generate_host_bills', { p_period: '2030-02-01' })
  check('next period -> one new bill', g3.status === 200 && g3.body.length === 1)
  const { body: items2 } = await admin(`host_bill_items?select=booking_id&bill_id=eq.${g3.body[0].id}`)
  check('next bill holds only the late-paid booking', items2.length === 1 && items2[0].booking_id === bLate.id)
  const { body: allItems } = await admin(`host_bill_items?select=booking_id&booking_id=in.(${bookingIds.join(',')})`)
  check('cancelled and pre-policy bookings never itemized', !allItems.some((i) => i.booking_id === bCancelled.id || i.booking_id === bPrePolicy.id))

  // ── RLS / grants ──
  const own = await asUser(hostTok, `host_bills?select=id,amount,items:host_bill_items(booking_id,amount)&order=period.desc`)
  check('host reads own bills with items', own.status === 200 && own.body.length === 2 && own.body[0].items.length === 1)
  const other = await asUser(renterTok, `host_bills?select=id`)
  check('renter reads zero bills', other.status === 200 && other.body.length === 0)
  const otherItems = await asUser(renterTok, `host_bill_items?select=id`)
  check('renter reads zero items', otherItems.status === 200 && otherItems.body.length === 0)
  const ins = await asUser(hostTok, 'host_bills', { method: 'POST', body: JSON.stringify({ host_id: hostId, period: '2031-01-01', amount: 1, due_at: new Date().toISOString() }) })
  check('host cannot insert a bill (privilege)', denied(ins), `${ins.status}`)
  const upd = await asUser(hostTok, `host_bills?id=eq.${bill.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) })
  const { body: [afterUpd] } = await admin(`host_bills?select=status&id=eq.${bill.id}`)
  check('host cannot mark own bill paid (privilege)', denied(upd) && afterUpd.status === 'issued', `${upd.status} ${afterUpd.status}`)
  const del = await asUser(hostTok, `host_bill_items?bill_id=eq.${bill.id}`, { method: 'DELETE' })
  const { body: itemsAfterDel } = await admin(`host_bill_items?select=id&bill_id=eq.${bill.id}`)
  check('host cannot delete items (privilege)', denied(del) && itemsAfterDel.length === 1, `${del.status}`)
  const rpcAsHost = await rpc(hostTok, 'generate_host_bills', { p_period: PERIOD })
  check('generate_host_bills denied to authenticated', denied(rpcAsHost), `${rpcAsHost.status}`)
  const markAsHost = await rpc(hostTok, 'mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: 'pi_x' })
  check('mark_host_bill_paid denied to authenticated', denied(markAsHost), `${markAsHost.status}`)

  // ── delinquency + enforcement trigger ──
  const d0 = await rpc(null, 'is_host_billing_delinquent', { p_host_id: hostId })
  check('anon can call is_host_billing_delinquent; false within grace', d0.status === 200 && d0.body === false, `${d0.status} ${d0.body}`)
  await admin(`host_bills?id=eq.${bill.id}`, { method: 'PATCH', body: JSON.stringify({ due_at: '2026-01-01T00:00:00Z' }) })
  const d1 = await rpc(null, 'is_host_billing_delinquent', { p_host_id: hostId })
  check('true once a bill is past due', d1.body === true)
  const blocked = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: '2027-05-10', p_return_date: '2027-05-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'host_qr', p_promo_code: null })
  check('host_qr booking refused for a delinquent host', blocked.status >= 400 && /direct QR/.test(blocked.body?.message ?? ''), `${blocked.status} ${blocked.body?.message}`)
  const ctrl = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: '2027-05-10', p_return_date: '2027-05-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'qrph', p_promo_code: null })
  check('CONTROL: qrph booking for the same host still allowed', ctrl.status === 200 && ctrl.body?.id, `${ctrl.status}`)
  if (ctrl.body?.id) bookingIds.push(ctrl.body.id)

  // ── mark paid (idempotent) releases enforcement ──
  const p1 = await rpc(SECRET, 'mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: 'pi_probe_061' })
  check('mark_host_bill_paid -> paid with ref', p1.status === 200 && p1.body?.status === 'paid' && p1.body?.paymongo_ref === 'pi_probe_061' && p1.body?.paid_at)
  const p2 = await rpc(SECRET, 'mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: 'pi_other' })
  check('second mark_host_bill_paid is a no-op (same paid_at, ref unchanged)', p2.body?.paid_at === p1.body?.paid_at && p2.body?.paymongo_ref === 'pi_probe_061')
  const d2 = await rpc(null, 'is_host_billing_delinquent', { p_host_id: hostId })
  check('delinquency cleared after payment', d2.body === false)
  const allowed = await rpc(renterTok, 'create_booking', { p_listing_id: listingId, p_pickup_date: '2027-06-10', p_return_date: '2027-06-12', p_is_delivery: false, p_delivery_address: null, p_payment_method: 'host_qr', p_promo_code: null })
  check('host_qr booking allowed again after payment', allowed.status === 200, `${allowed.status} ${allowed.body?.message ?? ''}`)
  if (allowed.body?.id) bookingIds.push(allowed.body.id)

  // ── void ──
  const bill2 = g3.body[0]
  const vNoReason = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2.id, p_reason: '  ' })
  check('void without a reason raises', vNoReason.status >= 400)
  const v1 = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2.id, p_reason: 'probe void' })
  check('void -> status void with reason', v1.status === 200 && v1.body?.status === 'void' && v1.body?.void_reason === 'probe void')
  const { body: itemsAfterVoid } = await admin(`host_bill_items?select=id&bill_id=eq.${bill2.id}`)
  check('void released the items', itemsAfterVoid.length === 0)
  const g4 = await rpc(SECRET, 'generate_host_bills', { p_period: '2030-03-01' })
  check('rerun re-bills the released booking on a new bill', g4.status === 200 && g4.body.length === 1 && g4.body[0].id !== bill2.id)
  const vPaid = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill.id, p_reason: 'should fail' })
  check('voiding a paid bill raises', vPaid.status >= 400)
  const vAgain = await rpc(SECRET, 'void_host_bill', { p_bill_id: bill2.id, p_reason: 'again' })
  check('voiding a void bill is a no-op with the original reason', vAgain.status === 200 && vAgain.body?.void_reason === 'probe void')
} finally {
  // Cleanup: bills (items cascade), bookings, listing, profiles rows are anonymised by auth delete cascade? No — profiles.id -> auth.users cascades, so deleting the auth user removes the profile row and, via bookings FK without cascade, would FAIL. Delete in dependency order instead.
  await admin(`host_bills?host_id=eq.${hostId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${hostId}`, { method: 'DELETE' })
  await admin(`notifications?user_id=eq.${renterId}`, { method: 'DELETE' })
  if (bookingIds.length) await admin(`bookings?id=in.(${bookingIds.join(',')})`, { method: 'DELETE' })
  if (listingId) await admin(`listings?id=eq.${listingId}`, { method: 'DELETE' })
  await admin(`profiles?id=in.(${hostId},${renterId})`, { method: 'DELETE' })
  await deleteUser(hostId); await deleteUser(renterId)
  const after = await baseline()
  for (const k of Object.keys(before)) check(`baseline ${k} ${before[k]} -> ${after[k]}`, before[k] === after[k])
  const { body: forb } = await admin(`profiles?select=id&id=eq.${FORBIDDEN_HOST}`)
  check('forbidden host untouched', forb.length === 1)
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
```

Note for the implementer: `create_booking` inserts a `bookings` row which fires `bookings_attach_conversation` (055) → a `conversations` row per booking, and the booking-request notification trigger. Deleting the bookings cascades the conversations; the notification cleanup above removes the rest. If the run leaves `conversations` or `availability_blocks` behind, add them to the baseline and cleanup — check with `admin('conversations?select=id&renter_id=eq.<renterId>')`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify/061-host-bills.mjs 2>&1 | grep -v Warning | head -5`
Expected: the first `generate #1` check FAILS (PostgREST `PGRST202`, function not found), and the baseline lines report `host_bills` queries failing (status 404 → `.body.length` throws). If the script throws before printing anything, that is also "failing" — the point is it cannot pass before the migration exists.

- [ ] **Step 3: Write migration 061**

Create `supabase/migrations/061_host_bills.sql`:

```sql
-- 061: host commission billing — the ledger.
-- See docs/superpowers/specs/2026-09-04-host-commission-billing-design.md.
--
-- Host-QR bookings put the renter's full total, Rentivo's 5% service fee
-- included, straight into the host's wallet. This ledger bills that fee back
-- monthly. Writes happen only through the three service-role RPCs below;
-- hosts can read their own rows. Enforcement is a BEFORE INSERT trigger on
-- bookings (never an edit to create_booking) driven by an anon-callable
-- security-definer helper, mirroring is_host_suspended() (046).
--
-- Replay-safe throughout.

do $$ begin
  create type public.host_bill_status as enum ('issued', 'paid', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.host_bills (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.profiles(id),
  period        date not null,
  amount        integer not null check (amount > 0),
  status        public.host_bill_status not null default 'issued',
  issued_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  paid_at       timestamptz,
  paymongo_ref  text,
  void_reason   text,
  created_at    timestamptz not null default now(),
  unique (host_id, period)
);
create index if not exists host_bills_host_idx on public.host_bills(host_id, period desc);
create index if not exists host_bills_paymongo_ref_idx on public.host_bills(paymongo_ref);
create index if not exists host_bills_overdue_idx on public.host_bills(host_id) where status = 'issued';

alter table public.host_bills enable row level security;

drop policy if exists "host_bills: own read" on public.host_bills;
create policy "host_bills: own read"
  on public.host_bills for select
  using (auth.uid() = host_id);

revoke all on public.host_bills from anon, authenticated;
grant select on public.host_bills to authenticated;
-- No insert/update/delete grant — writes only via the RPCs below.

create table if not exists public.host_bill_items (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.host_bills(id) on delete cascade,
  booking_id  uuid not null unique references public.bookings(id),
  amount      integer not null check (amount >= 0)
);
create index if not exists host_bill_items_bill_idx on public.host_bill_items(bill_id);

alter table public.host_bill_items enable row level security;

drop policy if exists "host_bill_items: own read" on public.host_bill_items;
create policy "host_bill_items: own read"
  on public.host_bill_items for select
  using (exists (select 1 from public.host_bills b where b.id = bill_id and b.host_id = auth.uid()));

revoke all on public.host_bill_items from anon, authenticated;
grant select on public.host_bill_items to authenticated;

-- ── generate_host_bills ────────────────────────────────────────────────────
-- One bill per host for p_period (first of month). Eligibility (the ONE
-- definition — src/lib/billing.ts only mirrors the policy start date):
--   host_qr, paid, not cancelled, paid_at >= POLICY_START,
--   paid_at < period + 1 month, not already itemized.
-- No lower bound inside the period on purpose: a booking marked paid after
-- its own month was billed is picked up by the next run, not lost.
-- Idempotent: unique (host_id, period) + unique booking_id. Returns only
-- the bills created by THIS call.
create or replace function public.generate_host_bills(p_period date)
returns setof public.host_bills
language plpgsql security definer set search_path = public
as $$
declare
  v_policy_start constant timestamptz := '2026-09-05 00:00+08';
  v_grace        constant interval    := interval '14 days';
  v_host         uuid;
  v_bill         public.host_bills;
begin
  if p_period is null or p_period <> date_trunc('month', p_period)::date then
    raise exception 'p_period must be the first day of a month.';
  end if;

  for v_host in
    select distinct b.host_id
      from public.bookings b
     where b.payment_method = 'host_qr'
       and b.payment_status = 'paid'
       and b.status <> 'cancelled'
       and b.paid_at >= v_policy_start
       and b.paid_at < (p_period + interval '1 month')
       and b.service_fee > 0
       and not exists (select 1 from public.host_bill_items i where i.booking_id = b.id)
       and not exists (select 1 from public.host_bills hb where hb.host_id = b.host_id and hb.period = p_period)
  loop
    with eligible as (
      select b.id, b.service_fee
        from public.bookings b
       where b.host_id = v_host
         and b.payment_method = 'host_qr'
         and b.payment_status = 'paid'
         and b.status <> 'cancelled'
         and b.paid_at >= v_policy_start
         and b.paid_at < (p_period + interval '1 month')
         and b.service_fee > 0
         and not exists (select 1 from public.host_bill_items i where i.booking_id = b.id)
    ),
    new_bill as (
      insert into public.host_bills (host_id, period, amount, due_at)
      select v_host, p_period, sum(e.service_fee), now() + v_grace
        from eligible e
      having sum(e.service_fee) > 0
      on conflict (host_id, period) do nothing
      returning *
    ),
    new_items as (
      insert into public.host_bill_items (bill_id, booking_id, amount)
      select nb.id, e.id, e.service_fee from new_bill nb, eligible e
      returning bill_id
    )
    select * into v_bill from new_bill;

    if v_bill.id is not null then
      return next v_bill;
    end if;
  end loop;
  return;
end;
$$;

revoke execute on function public.generate_host_bills(date) from public, anon, authenticated;
grant  execute on function public.generate_host_bills(date) to service_role;

-- ── mark_host_bill_paid ────────────────────────────────────────────────────
-- Idempotent like mark_booking_paid (009): already-paid returns unchanged.
create or replace function public.mark_host_bill_paid(p_bill_id uuid, p_paymongo_ref text default null)
returns public.host_bills
language plpgsql security definer set search_path = public
as $$
declare v_bill public.host_bills;
begin
  select * into v_bill from public.host_bills where id = p_bill_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_bill.status = 'paid' then return v_bill; end if;
  if v_bill.status = 'void' then raise exception 'Cannot mark a void bill as paid.'; end if;

  update public.host_bills
     set status = 'paid',
         paid_at = now(),
         paymongo_ref = coalesce(p_paymongo_ref, paymongo_ref)
   where id = p_bill_id
  returning * into v_bill;
  return v_bill;
end;
$$;

revoke execute on function public.mark_host_bill_paid(uuid, text) from public, anon, authenticated;
grant  execute on function public.mark_host_bill_paid(uuid, text) to service_role;

-- ── void_host_bill ─────────────────────────────────────────────────────────
-- Admin's only correction/waiver tool. Releases the items so a rerun bills
-- the bookings again. Paid bills cannot be voided.
create or replace function public.void_host_bill(p_bill_id uuid, p_reason text)
returns public.host_bills
language plpgsql security definer set search_path = public
as $$
declare v_bill public.host_bills;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to void a bill.';
  end if;
  select * into v_bill from public.host_bills where id = p_bill_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_bill.status = 'void' then return v_bill; end if;
  if v_bill.status = 'paid' then raise exception 'A paid bill cannot be voided.'; end if;

  delete from public.host_bill_items where bill_id = p_bill_id;
  update public.host_bills
     set status = 'void', void_reason = trim(p_reason)
   where id = p_bill_id
  returning * into v_bill;
  return v_bill;
end;
$$;

revoke execute on function public.void_host_bill(uuid, text) from public, anon, authenticated;
grant  execute on function public.void_host_bill(uuid, text) to service_role;

-- ── is_host_billing_delinquent ─────────────────────────────────────────────
-- security definer so the answer never depends on what the caller may read
-- from host_bills (same reasoning as is_host_suspended, 046).
create or replace function public.is_host_billing_delinquent(p_host_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.host_bills b
     where b.host_id = p_host_id and b.status = 'issued' and b.due_at < now()
  );
$$;

revoke execute on function public.is_host_billing_delinquent(uuid) from public;
grant  execute on function public.is_host_billing_delinquent(uuid) to anon, authenticated;

-- ── enforcement trigger ────────────────────────────────────────────────────
-- A trigger, not an edit to create_booking: that body has been copied across
-- migrations often enough to cause two security incidents (038/039, 040).
create or replace function public.block_delinquent_host_qr()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_method = 'host_qr' and public.is_host_billing_delinquent(new.host_id) then
    raise exception 'This host can''t accept direct QR payments right now. Please choose another payment method.';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_block_delinquent_host_qr on public.bookings;
create trigger bookings_block_delinquent_host_qr
  before insert on public.bookings
  for each row execute function public.block_delinquent_host_qr();
```

- [ ] **Step 4: Apply and confirm**

Run: `supabase db push --linked --yes 2>&1 | grep -E "Applying|Finished|ERROR"; supabase migration list --linked 2>&1 | grep -o '"local":"061","remote":"061"'`
Expected: `Applying migration 061_host_bills.sql...`, `Finished supabase db push.`, and the `061` pair printed. Ignore pg-delta certificate noise.

- [ ] **Step 5: Run the script to verify it passes**

Run: `node scripts/verify/061-host-bills.mjs 2>&1 | grep -v Warning`
Expected: every line `PASS`, ending `ALL PASSED`, with every `baseline ... -> ...` equal. If a baseline differs, find the leftover row (conversations, availability_blocks, notifications) and extend cleanup; do not accept a drifted baseline.

- [ ] **Step 6: Re-run the grant audit**

Write `/tmp`-free scratch file `scratchpad/audit.sql`:
```sql
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('host_bills','host_bill_items')
   and grantee in ('anon','authenticated')
 order by table_name, grantee, privilege_type;
```
Run: `supabase db query --linked -f <scratchpad>/audit.sql`
Expected: exactly two rows, both `authenticated` / `SELECT`. No `anon` rows, no INSERT/UPDATE/DELETE. Record the output in the commit message body.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/061_host_bills.sql scripts/verify/061-host-bills.mjs
git commit -m "Add host commission billing ledger, RPCs and enforcement trigger (061)"
```

---

### Task 2: Notification type (062 + 063), app types, icon

**Files:**
- Create: `supabase/migrations/062_bill_notification_type.sql`
- Create: `supabase/migrations/063_host_bills_notify.sql`
- Modify: `src/types/index.ts` (Notification type union at ~line 168; add `HostBill`, `HostBillItem` after `PayoutRequest`)
- Modify: `src/app/(main)/dashboard/notifications/page.tsx` (`ICONS` at line 16)
- Modify: `scripts/verify/061-host-bills.mjs`

**Interfaces:**
- Consumes: Task 1's `generate_host_bills`.
- Produces: enum value `bill_issued`; TS types `HostBill`, `HostBillItem`; a `bill_issued` notification row per generated bill with `link = '/dashboard/bills'`.

- [ ] **Step 1: Extend the script with a failing notification assertion**

In `scripts/verify/061-host-bills.mjs`, immediately after the `check('bill amount = ...')` line, add:

```js
  const { body: notif } = await admin(`notifications?select=type,title,body,link&user_id=eq.${hostId}&type=eq.bill_issued`)
  check('bill_issued notification written for the host', notif.length === 1 && notif[0].link === '/dashboard/bills' && /January 2030/.test(notif[0].title) && notif[0].body.includes(`₱${bill.amount.toLocaleString('en-PH')}`), JSON.stringify(notif).slice(0, 160))
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/verify/061-host-bills.mjs 2>&1 | grep -E "FAIL|PASSED|FAILED"`
Expected: `FAIL bill_issued notification written for the host` (the query returns 400, enum value unknown, or zero rows), everything else PASS.

- [ ] **Step 3: Write 062 (enum value only)**

`supabase/migrations/062_bill_notification_type.sql`:
```sql
-- 062: notification type for a newly issued commission bill. Own file:
-- Postgres forbids using a new enum value in the transaction that adds it
-- (precedent: 027, 036, 042). Nothing else in this file.
alter type public.notification_type add value if not exists 'bill_issued';
```

- [ ] **Step 4: Write 063 (generate_host_bills with the notification insert)**

`supabase/migrations/063_host_bills_notify.sql` — copy the ENTIRE `generate_host_bills` body from 061 verbatim and add, inside the loop directly after `if v_bill.id is not null then`, before `return next v_bill;`:

```sql
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_bill.host_id,
        'bill_issued',
        'Commission bill for ' || to_char(p_period, 'FMMonth YYYY'),
        '₱' || to_char(v_bill.amount, 'FM999,999,999') || ' for '
          || (select count(*) from public.host_bill_items i where i.bill_id = v_bill.id)
          || ' direct QR booking' || case when (select count(*) from public.host_bill_items i where i.bill_id = v_bill.id) = 1 then '' else 's' end
          || '. Due ' || to_char(v_bill.due_at at time zone 'Asia/Manila', 'FMMonth DD, YYYY') || '.',
        '/dashboard/bills'
      );
```

Header comment for the file:
```sql
-- 063: generate_host_bills (061) redefined verbatim with one addition — the
-- bill_issued notification insert, which could not live in 061 because 062
-- adds the enum value and a value cannot be used in the transaction that
-- adds it. Notifications stay written only by security-definer code (012).
-- The grants are re-issued so this file is complete on its own.
```
End the file with the same `revoke execute ... / grant execute ... to service_role;` pair as 061.

- [ ] **Step 5: Apply and confirm**

Run: `supabase db push --linked --yes 2>&1 | grep -E "Applying|Finished|ERROR"; supabase migration list --linked 2>&1 | grep -o '"local":"06[23]","remote":"06[23]"'`
Expected: both 062 and 063 applied and listed.

- [ ] **Step 6: Run the script to verify it passes**

Run: `node scripts/verify/061-host-bills.mjs 2>&1 | grep -E "FAIL|PASSED|FAILED"`
Expected: `ALL PASSED`. (The cleanup already deletes the host's notifications.)

- [ ] **Step 7: App types and icon**

In `src/types/index.ts`, add `| 'bill_issued'` to `Notification['type']` after `'verification_rejected'`, and after `PayoutRequest` add:

```ts
export interface HostBillItem {
  id: string
  bill_id: string
  booking_id: string
  amount: number
  /** Embedded by useHostBills for the breakdown; not a column. */
  booking?: Pick<Booking, 'booking_ref' | 'pickup_date' | 'return_date' | 'rental_fee' | 'paid_at'> | null
}

export interface HostBill {
  id: string
  host_id: string
  /** First day of the billed month, 'YYYY-MM-DD'. */
  period: string
  amount: number
  status: 'issued' | 'paid' | 'void'
  issued_at: string
  due_at: string
  paid_at: string | null
  paymongo_ref: string | null
  void_reason: string | null
  created_at: string
  items?: HostBillItem[]
}
```
Confirm `Booking` has `paid_at: string | null` — if not, add it (009 added the column).

In `src/app/(main)/dashboard/notifications/page.tsx`, import `Receipt` from `lucide-react` and add to `ICONS`:
```ts
  bill_issued: { icon: Receipt, color: 'text-[#003049] bg-blue-50' },
```

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.
```bash
git add supabase/migrations/062_bill_notification_type.sql supabase/migrations/063_host_bills_notify.sql src/types/index.ts "src/app/(main)/dashboard/notifications/page.tsx" scripts/verify/061-host-bills.mjs
git commit -m "Notify hosts in-app when a commission bill is issued (062, 063)"
```

---

### Task 3: `src/lib/billing.ts`, bill email, cron route, admin run route

**Files:**
- Create: `src/lib/billing.ts`
- Modify: `src/lib/email.ts` (append `notifyHostBillIssued`)
- Create: `src/app/api/cron/host-bills/route.ts`
- Create: `src/app/api/admin/bills/run/route.ts`
- Create: `vercel.json`
- Create: `scripts/verify/064-bill-routes.mjs`
- Modify: `.env.local` (add `CRON_SECRET`)

**Interfaces:**
- Consumes: `generate_host_bills`, `requireAdminApi()` (`src/lib/admin.ts`, returns `User | NextResponse`), `createAdminClient()`, email helpers `send`, `layout`, `button`, `escapeHtml`, `fmtPeso`, `fmtDate`, `emailForUser` (all module-private in `email.ts` — the new function lives in the same file).
- Produces: `POLICY_START: string`, `GRACE_DAYS = 14`, `previousPeriod(now?: Date): string` ('YYYY-MM-01' in UTC of the month before), `periodLabel(period: string): string` ('January 2030'), `isOverdue(bill): boolean`; `notifyHostBillIssued(billId: string): Promise<void>`; `GET /api/cron/host-bills` → `{ period, created }`; `POST /api/admin/bills/run { period: 'YYYY-MM' }` → `{ period, created }`.

- [ ] **Step 1: Write the failing route script**

`scripts/verify/064-bill-routes.mjs` (grown in Task 4). Uses a dev server on 3100 and the demo host cookie for admin (local `ADMIN_EMAILS` includes `demo@demo.rentivo.ph`).

```js
// Verifies the billing HTTP routes against a dev server on :3100 and the
// hosted database. Run: node scripts/verify/064-bill-routes.mjs
import { readFileSync } from 'node:fs'
import { URL as SUPABASE_URL, ANON, admin } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_KEY = `sb-${REF}-auth-token`
const CRON_SECRET = (readFileSync('.env.local', 'utf8').match(/^CRON_SECRET=(.+)$/m) ?? [])[1]?.trim()
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails++ }

async function signInFull(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  const json = await res.json(); if (!json.access_token) throw new Error(`sign-in failed: ${JSON.stringify(json)}`); return json
}
function cookieHeaderFor(session) {
  const value = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const CHUNK = 3180
  if (value.length <= CHUNK) return `${COOKIE_KEY}=${value}`
  return Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => `${COOKIE_KEY}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`).join('; ')
}
export { APP, check, signInFull, cookieHeaderFor, admin }

const adminCookie = cookieHeaderFor(await signInFull('demo@demo.rentivo.ph', 'DemoRentivo1'))
const renterCookie = cookieHeaderFor(await signInFull('renter@demo.rentivo.ph', 'DemoRentivo1'))

// ── cron route ──
const noSecret = await fetch(`${APP}/api/cron/host-bills`)
check('cron: 401 without secret', noSecret.status === 401, `${noSecret.status}`)
const wrong = await fetch(`${APP}/api/cron/host-bills`, { headers: { Authorization: 'Bearer nope' } })
check('cron: 401 with wrong secret', wrong.status === 401, `${wrong.status}`)
const ok = await fetch(`${APP}/api/cron/host-bills`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })
const okBody = await ok.json()
check('cron: 200 with secret, reports previous month', ok.status === 200 && /^\d{4}-\d{2}-01$/.test(okBody.period) && typeof okBody.created === 'number', `${ok.status} ${JSON.stringify(okBody)}`)

// ── admin run route ──
const anonRun = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2030-06' }) })
check('admin run: 404 signed out', anonRun.status === 404, `${anonRun.status}`)
const renterRun = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: renterCookie }, body: JSON.stringify({ period: '2030-06' }) })
check('admin run: 404 as non-admin', renterRun.status === 404, `${renterRun.status}`)
const badPeriod = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ period: 'nope' }) })
check('admin run: 400 on a malformed period', badPeriod.status === 400, `${badPeriod.status}`)
const goodRun = await fetch(`${APP}/api/admin/bills/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ period: '2030-06' }) })
const goodBody = await goodRun.json()
check('admin run: 200 as admin, created 0 for an empty far-future month', goodRun.status === 200 && goodBody.period === '2030-06-01' && goodBody.created === 0, `${goodRun.status} ${JSON.stringify(goodBody)}`)

if (!process.env.BILL_ROUTES_CONTINUE) { console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0) }
```

- [ ] **Step 2: Start a dev server and run to verify it fails**

Run (background): `npm run dev -- -p 3100 > <scratchpad>/dev.log 2>&1 &` then `sleep 6; node scripts/verify/064-bill-routes.mjs 2>&1 | grep -v Warning`
Expected: every route check FAILS with 404s (routes don't exist).

- [ ] **Step 3: Write `src/lib/billing.ts`**

```ts
/**
 * Host commission billing — shared constants and pure helpers.
 * Client-safe (no server imports). The two policy numbers below MUST match
 * generate_host_bills() in supabase/migrations/061_host_bills.sql.
 */
import type { HostBill } from '@/types'

/** Bookings marked paid at or after this instant are billable. */
export const POLICY_START = '2026-09-05T00:00:00+08:00'
export const POLICY_START_LABEL = 'September 5, 2026'
export const GRACE_DAYS = 14

/** 'YYYY-MM-01' for the UTC month before `now`. */
export function previousPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based
  const d = new Date(Date.UTC(y, m - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** 'YYYY-MM' (form input) -> 'YYYY-MM-01'; returns null when malformed. */
export function normalizePeriod(input: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(input.trim())
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

/** 'YYYY-MM-DD' -> 'January 2030'. Formats the string directly: a `date`
 *  column has no time zone, and new Date('2030-01-01') is UTC midnight,
 *  which a negative-offset runtime renders as December. */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function isOverdue(bill: Pick<HostBill, 'status' | 'due_at'>, now: Date = new Date()): boolean {
  return bill.status === 'issued' && new Date(bill.due_at).getTime() < now.getTime()
}
```

- [ ] **Step 4: Add `notifyHostBillIssued` to `src/lib/email.ts`**

Append at the end of the file (it uses the module's private `send`, `layout`, `button`, `escapeHtml`, `fmtPeso`, `fmtDate`, `emailForUser`, `APP_URL`; add `import { periodLabel } from '@/lib/billing'` at the top):

```ts
/**
 * Commission bill issued (host commission billing). Not gated by any
 * notify_* preference: it is a bill, not a courtesy. Fired by the cron route
 * and the admin run route for each bill generate_host_bills() returns.
 */
export async function notifyHostBillIssued(billId: string) {
  const admin = createAdminClient()
  const { data: bill } = await admin
    .from('host_bills')
    .select('id, host_id, period, amount, due_at, items:host_bill_items(amount, booking:bookings!host_bill_items_booking_id_fkey(booking_ref, pickup_date, return_date, rental_fee))')
    .eq('id', billId)
    .maybeSingle()
  if (!bill) return
  const to = await emailForUser(bill.host_id)
  if (!to) return
  const items = (bill.items ?? []) as unknown as { amount: number; booking: { booking_ref: string; pickup_date: string; return_date: string; rental_fee: number } | null }[]
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${escapeHtml(i.booking?.booking_ref ?? '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${i.booking ? `${fmtDate(i.booking.pickup_date)} – ${fmtDate(i.booking.return_date)}` : '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">${i.booking ? fmtPeso(i.booking.rental_fee) : '—'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;"><strong>${fmtPeso(i.amount)}</strong></td>
      </tr>`
    )
    .join('')
  const label = periodLabel(bill.period)
  await send(
    to,
    `Your Rentivo commission bill for ${label}`,
    layout(
      `Commission bill for ${label}: ${fmtPeso(bill.amount)}`,
      `<h2 style="margin:0 0 12px;color:#003049;">Commission bill — ${escapeHtml(label)}</h2>
       <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
         Renters paid <strong>${fmtPeso(bill.amount)}</strong> in Rentivo service fees directly into your GCash/Maya account on the bookings below.
         This bill collects that 5% commission. It is due <strong>${fmtDate(bill.due_at)}</strong>.
       </p>
       <table style="width:100%;border-collapse:collapse;font-size:13px;color:#111827;">
         <thead><tr style="color:#6b7280;font-size:12px;"><th align="left" style="padding:6px 8px;">Booking</th><th align="left" style="padding:6px 8px;">Dates</th><th align="right" style="padding:6px 8px;">Rental</th><th align="right" style="padding:6px 8px;">Fee</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
       ${button(`${APP_URL}/dashboard/bills`, 'View and pay bill')}
       <p style="margin:16px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">
         If the bill is still unpaid after the due date, the direct GCash/Maya QR option is withheld on your listings until it is settled. Your listings stay live and bookable through Rentivo's other payment methods.
       </p>`
    )
  )
}
```
Check `email.ts` already imports `createAdminClient`; `loadBookingContext` uses it, so it does. Confirm `layout(preheader, bodyHtml)` and `button(href, label)` signatures match lines 16 and 43 of the file before using them.

- [ ] **Step 5: Cron route**

`src/app/api/cron/host-bills/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyHostBillIssued } from '@/lib/email'
import { previousPeriod } from '@/lib/billing'
import type { HostBill } from '@/types'

/**
 * Monthly commission billing. Vercel cron (vercel.json) calls this at 01:00
 * UTC on the 1st with `Authorization: Bearer <CRON_SECRET>`; anything else
 * is a 401. generate_host_bills is idempotent, so a rerun creates nothing.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const period = previousPeriod()
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_host_bills', { p_period: period })
  if (error) {
    console.error('[cron] generate_host_bills failed', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const bills = (data ?? []) as HostBill[]
  for (const bill of bills) {
    notifyHostBillIssued(bill.id).catch((e) => console.error('[email] notifyHostBillIssued failed', e))
  }
  return NextResponse.json({ period, created: bills.length })
}
```

- [ ] **Step 6: Admin run route**

`src/app/api/admin/bills/run/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyHostBillIssued } from '@/lib/email'
import { normalizePeriod } from '@/lib/billing'
import type { HostBill } from '@/types'

export async function POST(req: Request) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate

  let body: { period?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const period = typeof body.period === 'string' ? normalizePeriod(body.period) : null
  if (!period) {
    return NextResponse.json({ error: 'period must be YYYY-MM.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('generate_host_bills', { p_period: period })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const bills = (data ?? []) as HostBill[]
  for (const bill of bills) {
    notifyHostBillIssued(bill.id).catch((e) => console.error('[email] notifyHostBillIssued failed', e))
  }
  return NextResponse.json({ period, created: bills.length })
}
```

- [ ] **Step 7: `vercel.json` and the secret**

`vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/host-bills", "schedule": "0 1 1 * *" }]
}
```
Append to `.env.local`: `CRON_SECRET=<output of: openssl rand -hex 32>`. Do NOT commit `.env.local` (it is gitignored). The Vercel production value is set in Task 10.

- [ ] **Step 8: Restart the dev server and run the script**

Kill: `kill $(lsof -t -iTCP:3100 -sTCP:LISTEN)`; wait for the port to free; start again (the new env var needs a restart). Run: `node scripts/verify/064-bill-routes.mjs 2>&1 | grep -v Warning`
Expected: `ALL PASSED`. The cron call with the secret runs `generate_host_bills` for the real previous month — with `POLICY_START` in the future relative to any existing `paid_at`, it creates 0 bills. Confirm: `created: 0` in the output. If it created any, STOP and investigate before anything else — that would mean a real host was billed.

- [ ] **Step 9: Typecheck, lint, build, commit**

Run: `npx tsc --noEmit && npm run lint && npm run build 2>&1 | grep -E "rror|Compiled"`
Expected: clean, `✓ Compiled successfully`.
```bash
git add src/lib/billing.ts src/lib/email.ts src/app/api/cron/host-bills/route.ts src/app/api/admin/bills/run/route.ts vercel.json scripts/verify/064-bill-routes.mjs
git commit -m "Generate commission bills monthly via cron and an admin run route"
```

---

### Task 4: Pay route, verify-payment route, webhook branch

**Files:**
- Create: `src/app/api/bills/[id]/pay/route.ts`
- Create: `src/app/api/bills/[id]/verify-payment/route.ts`
- Modify: `src/app/api/webhooks/paymongo/route.ts:37-55`
- Modify: `scripts/verify/064-bill-routes.mjs`

**Interfaces:**
- Consumes: `createPaymentIntent`, `createQrPhPaymentMethod`, `attachPaymentIntent`, `getPaymentIntent`, `paymentErrorMessage`, `isPayMongoConfigured`, `verifyWebhookSignature` from `src/lib/paymongo.ts`; `mark_host_bill_paid`.
- Produces: `POST /api/bills/[id]/pay` → `{ qrImage: string, billId }` | 400 | 404 | 502; `POST /api/bills/[id]/verify-payment` → `{ status: 'paid' | 'processing' | 'unpaid' }`; webhook marks a bill paid when the intent matches `host_bills.paymongo_ref`.

- [ ] **Step 1: Extend the route script with failing pay/verify/webhook checks**

Append to `scripts/verify/064-bill-routes.mjs` before the final `if (!process.env.BILL_ROUTES_CONTINUE)` line, and change that line's guard so this section always runs (delete the guard, keep the summary at the very end):

```js
// ── pay / verify / webhook ──
// A real issued bill for the demo host, inserted with admin (generate needs
// real bookings; the pay route only needs the row).
const { body: [probeBill] } = await admin('host_bills', { method: 'POST', body: JSON.stringify({ host_id: JSON.parse(Buffer.from(adminCookie.split('base64-')[1].split(';')[0], 'base64url').toString()).user.id, period: '2031-01-01', amount: 123, due_at: new Date(Date.now() + 14 * 864e5).toISOString() }) })
try {
  const strangerPay = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: renterCookie } })
  check('pay: 404 for a bill that is not yours', strangerPay.status === 404, `${strangerPay.status}`)
  const anonPay = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST' })
  check('pay: 401 signed out', anonPay.status === 401, `${anonPay.status}`)
  const pay = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
  const payBody = await pay.json()
  check('pay: 200 with a QR image for the owner (test-mode PayMongo)', pay.status === 200 && typeof payBody.qrImage === 'string' && payBody.qrImage.startsWith('data:image/'), `${pay.status} ${JSON.stringify(payBody).slice(0, 100)}`)
  const { body: [afterPay] } = await admin(`host_bills?select=paymongo_ref,status&id=eq.${probeBill.id}`)
  check('pay: paymongo_ref stored, still issued', /^pi_/.test(afterPay.paymongo_ref ?? '') && afterPay.status === 'issued', JSON.stringify(afterPay))

  const verify = await fetch(`${APP}/api/bills/${probeBill.id}/verify-payment`, { method: 'POST', headers: { Cookie: adminCookie } })
  const verifyBody = await verify.json()
  check('verify-payment: unpaid intent reports unpaid/processing', verify.status === 200 && ['unpaid', 'processing'].includes(verifyBody.status), `${verify.status} ${JSON.stringify(verifyBody)}`)

  // Webhook replay: a signed payment.paid event for the bill's intent.
  const { createHmac } = await import('node:crypto')
  const whsec = (readFileSync('.env.local', 'utf8').match(/^PAYMONGO_WEBHOOK_SECRET=(.+)$/m) ?? [])[1]?.trim()
  if (whsec) {
    const raw = JSON.stringify({ data: { attributes: { type: 'payment.paid', data: { attributes: { payment_intent_id: afterPay.paymongo_ref } } } } })
    const ts = Math.floor(Date.now() / 1000)
    const sig = createHmac('sha256', whsec).update(`${ts}.${raw}`).digest('hex')
    const wh = await fetch(`${APP}/api/webhooks/paymongo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'paymongo-signature': `t=${ts},te=${sig},li=` }, body: raw })
    check('webhook: signed payment.paid accepted', wh.status === 200, `${wh.status}`)
    const { body: [afterWh] } = await admin(`host_bills?select=status,paid_at,paymongo_ref&id=eq.${probeBill.id}`)
    check('webhook: bill marked paid via paymongo_ref match', afterWh.status === 'paid' && afterWh.paid_at && afterWh.paymongo_ref === afterPay.paymongo_ref, JSON.stringify(afterWh))
    const payAgain = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
    check('pay: 400 on a paid bill', payAgain.status === 400, `${payAgain.status}`)
  } else {
    console.log('SKIP webhook replay (no PAYMONGO_WEBHOOK_SECRET locally) — mark paid via RPC instead')
    await admin('rpc/mark_host_bill_paid', { method: 'POST', body: JSON.stringify({ p_bill_id: probeBill.id, p_paymongo_ref: afterPay.paymongo_ref }) })
    const payAgain = await fetch(`${APP}/api/bills/${probeBill.id}/pay`, { method: 'POST', headers: { Cookie: adminCookie } })
    check('pay: 400 on a paid bill', payAgain.status === 400, `${payAgain.status}`)
  }
} finally {
  await admin(`host_bills?id=eq.${probeBill.id}`, { method: 'DELETE' })
  const { body: gone } = await admin(`host_bills?select=id&id=eq.${probeBill.id}`)
  check('cleanup: probe bill deleted', gone.length === 0)
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
```
Note: `verifyWebhookSignature` (paymongo.ts:188) checks `te` against the test secret or `li` against live; read its implementation and match the header format exactly (`t=<ts>,te=<hex>,li=<hex>`; the signed payload is `${ts}.${rawBody}`). If the local secret is a live one, put the signature in `li` instead. The `admin('rpc/...')` fallback works because `admin()` posts to `/rest/v1/<path>`.

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/verify/064-bill-routes.mjs 2>&1 | grep -E "FAIL|PASS|SKIP" | tail -12`
Expected: pay/verify checks FAIL with 404 (routes missing); webhook check `bill marked paid` FAILS (no bill branch yet).

- [ ] **Step 3: Pay route**

`src/app/api/bills/[id]/pay/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isPayMongoConfigured,
  createPaymentIntent,
  createQrPhPaymentMethod,
  attachPaymentIntent,
  paymentErrorMessage,
} from '@/lib/paymongo'
import { periodLabel } from '@/lib/billing'

/**
 * Host pays a commission bill via QR Ph. Creates a PayMongo intent tagged
 * with the bill id, stores the intent id on the bill (the webhook matches on
 * it), attaches a qrph method and returns the QR image to scan. A second
 * click overwrites paymongo_ref with a fresh intent; the earlier one never
 * pays. Only the bill's own host can reach it (RLS + explicit filter).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const { data: bill } = await supabase
    .from('host_bills')
    .select('id, host_id, period, amount, status')
    .eq('id', id)
    .eq('host_id', user.id)
    .maybeSingle()
  if (!bill) {
    return NextResponse.json({ error: 'Bill not found.' }, { status: 404 })
  }
  if (bill.status !== 'issued') {
    return NextResponse.json({ error: `This bill is already ${bill.status}.` }, { status: 400 })
  }
  if (!isPayMongoConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  }

  try {
    const admin = createAdminClient()
    const intent = await createPaymentIntent({
      amountCentavos: bill.amount * 100,
      description: `Rentivo commission — ${periodLabel(bill.period)}`,
      metadata: { host_bill_id: bill.id },
    })
    await admin.from('host_bills').update({ paymongo_ref: intent.id }).eq('id', bill.id)

    const pm = await createQrPhPaymentMethod()
    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/bills`
    const attached = await attachPaymentIntent(intent.id, pm.id, returnUrl)
    const nextAction = attached.attributes.next_action
    if (attached.attributes.status === 'awaiting_next_action' && nextAction && 'code' in nextAction) {
      return NextResponse.json({ qrImage: nextAction.code.image_url, billId: bill.id })
    }
    return NextResponse.json({ error: paymentErrorMessage(attached), billId: bill.id }, { status: 502 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed. Please try again.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```
Note: `admin.from('host_bills').update(...)` works because the service role bypasses the missing UPDATE grant. The `metadata` key on `createPaymentIntent` already exists (checkout route uses it).

- [ ] **Step 4: Verify-payment route**

`src/app/api/bills/[id]/verify-payment/route.ts` — mirror of `src/app/api/bookings/[id]/verify-payment/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPayMongoConfigured, getPaymentIntent } from '@/lib/paymongo'

/** Same escape hatch as /api/bookings/[id]/verify-payment: QR Ph has no
 *  redirect back, so if the webhook is delayed the host can ask PayMongo
 *  directly. mark_host_bill_paid is idempotent, so repeated calls are safe. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: bill } = await supabase
    .from('host_bills')
    .select('id, status, paymongo_ref')
    .eq('id', id)
    .eq('host_id', user.id)
    .maybeSingle()
  if (!bill) return NextResponse.json({ error: 'Bill not found.' }, { status: 404 })
  if (bill.status === 'paid') return NextResponse.json({ status: 'paid' })
  if (!bill.paymongo_ref || !isPayMongoConfigured()) return NextResponse.json({ status: 'unpaid' })

  try {
    const intent = await getPaymentIntent(bill.paymongo_ref)
    const s = intent.attributes.status
    if (s === 'succeeded') {
      const admin = createAdminClient()
      const { error } = await admin.rpc('mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: bill.paymongo_ref })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ status: 'paid' })
    }
    return NextResponse.json({ status: s === 'processing' ? 'processing' : 'unpaid' })
  } catch {
    return NextResponse.json({ error: "Couldn't reach PayMongo to check this payment. Please try again." }, { status: 502 })
  }
}
```

- [ ] **Step 5: Webhook branch**

In `src/app/api/webhooks/paymongo/route.ts`, replace the block from `const admin = createAdminClient()` through the closing of `if (booking && ...)` with:

```ts
      const admin = createAdminClient()
      const { data: booking } = await admin
        .from('bookings')
        .select('id, payment_status')
        .eq('paymongo_ref', intentId)
        .maybeSingle()
      if (booking) {
        if (booking.payment_status !== 'paid') {
          await admin.rpc('mark_booking_paid', {
            p_booking_id: booking.id,
            p_paymongo_ref: intentId,
          })
          notifyBookingPaid(booking.id).catch((e) => console.error('[email] notifyBookingPaid failed', e))
        }
      } else {
        // Not a booking: a host commission bill paid via QR Ph (the pay route
        // stores the intent id on host_bills.paymongo_ref). Idempotent RPC, so
        // a replayed event is harmless. No email on bill payment — the Bills
        // page flips to Paid and that is the receipt.
        const { data: bill } = await admin
          .from('host_bills')
          .select('id, status')
          .eq('paymongo_ref', intentId)
          .maybeSingle()
        if (bill && bill.status === 'issued') {
          await admin.rpc('mark_host_bill_paid', { p_bill_id: bill.id, p_paymongo_ref: intentId })
        }
      }
```

- [ ] **Step 6: Run the script to verify it passes**

Run: `node scripts/verify/064-bill-routes.mjs 2>&1 | grep -v Warning`
Expected: `ALL PASSED` (or the documented `SKIP` line for the webhook replay if no local webhook secret, with the RPC fallback path passing). A real test-mode PayMongo intent is created; that is expected and harmless.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/api/bills/[id]/pay/route.ts" "src/app/api/bills/[id]/verify-payment/route.ts" src/app/api/webhooks/paymongo/route.ts scripts/verify/064-bill-routes.mjs
git commit -m "Let hosts pay commission bills via QR Ph; webhook marks bills paid"
```

---

### Task 5: Checkout tile gating for delinquent hosts

**Files:**
- Modify: `src/components/booking/Step3Payment.tsx:123-128`

**Interfaces:**
- Consumes: `is_host_billing_delinquent(p_host_id)` (anon-callable), `listing.host_id`.
- Produces: the host-QR tile is absent while the host is delinquent; `method` never defaults to `host_qr`.

- [ ] **Step 1: Read the surrounding code**

Open `Step3Payment.tsx` lines 100–130. Note `hasHostQr` is computed from `listing.host?.qr_payment_url` and `methods` is built from it; `useUser` and `createClient` are already imported.

- [ ] **Step 2: Add the delinquency check**

Directly above `const hasHostQr = ...` add:
```ts
  // Withhold the direct-QR tile while the host has an overdue commission bill
  // (host commission billing, 061). The database trigger refuses such a
  // booking anyway; this just never shows an option that would be refused.
  // is_host_billing_delinquent is anon-callable and security definer, same
  // shape as is_host_suspended on /dashboard/rentals.
  const [hostDelinquent, setHostDelinquent] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!listing.host?.qr_payment_url) return
    createClient()
      .rpc('is_host_billing_delinquent', { p_host_id: listing.host_id })
      .then(({ data }) => {
        if (!cancelled) setHostDelinquent(Boolean(data))
      })
    return () => {
      cancelled = true
    }
  }, [listing.host_id, listing.host?.qr_payment_url])
```
and change `const hasHostQr = Boolean(listing.host?.qr_payment_url)` to `const hasHostQr = Boolean(listing.host?.qr_payment_url) && !hostDelinquent`. Add `useEffect` to the React import if missing. If the file's `method` state could already be `'host_qr'` when the tile disappears (it cannot: the default is `enabledPaymentMethods()[0]`, and the tile is what sets `host_qr`), no reset is needed; add a one-line comment saying so.

- [ ] **Step 3: Verify in the browser (mock-free, live DB)**

Start the dev server on 3100 if not running. With admin, set a real host's bill overdue temporarily — DON'T. Instead, verify the negative path structurally and the positive path live: open `/book?listing=<a listing whose host has a QR>&from=2027-07-10&to=2027-07-12` signed in as the demo renter, reach Step 3, confirm the "GCash/Maya QR (Direct to Host)" tile is present (host not delinquent). Then, in the browser console, confirm the RPC call happened: `await (await fetch('<SUPABASE_URL>/rest/v1/rpc/is_host_billing_delinquent', {method:'POST',headers:{apikey:'<anon>','Content-Type':'application/json'},body:JSON.stringify({p_host_id:'<host id>'})})).json()` → `false`. The delinquent branch is proven by Task 1's trigger test plus reading this code; note that in the commit message.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/booking/Step3Payment.tsx
git commit -m "Hide the direct-QR checkout tile while a host has an overdue commission bill"
```

---

### Task 6: Account-deletion gate for issued bills

**Files:**
- Modify: `src/lib/account-deletion.ts` (`DeletionBlocker` type ~line 40, `checkDeletionEligibility` lines 70–150, module header comment)
- Modify: `src/app/api/account/delete/route.ts:37-63`
- Modify: `src/app/api/admin/users/[id]/delete/route.ts` (wherever it maps `blocking`)
- Modify: `src/app/admin/users/[id]/page.tsx:263` and the component that renders `blocking` (find with `grep -rn "pendingPayouts" src/`)
- Modify: `scripts/verify/061-host-bills.mjs`

**Interfaces:**
- Consumes: `host_bills`.
- Produces: `DeletionBlocker` gains `issuedBills: number`; a host with an `issued` bill gets `ok: false`, reason `'This account has an unpaid commission bill. It must be paid or voided first.'`.

- [ ] **Step 1: Extend the script with a failing gate assertion**

In `scripts/verify/061-host-bills.mjs`, after the `check('bill belongs to the probe host...')` line, call the module directly (it is server code; run it through Node's type stripping the way the 059 script ran `paymongo.ts`):

Simpler and honest: assert via the self-service route? That needs a dev server. Instead add to the script, right after generation:
```js
  // Deletion gate (Task 6): the module is exercised through the admin delete
  // route in scripts/verify/064-bill-routes.mjs; here we only assert the data
  // precondition it relies on.
  const { body: issuedForHost } = await admin(`host_bills?select=id&host_id=eq.${hostId}&status=eq.issued`)
  check('precondition: host has an issued bill for the deletion gate', issuedForHost.length === 1)
```
And in `scripts/verify/064-bill-routes.mjs`, inside the pay/verify `try` block BEFORE the webhook replay (while the probe bill is still `issued`), add:
```js
  const delBlocked = await fetch(`${APP}/api/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ confirm: 'DELETE' }) })
  const delBody = await delBlocked.json()
  check('account delete: 400 while a commission bill is issued', delBlocked.status === 400 && /commission bill/i.test(delBody.error ?? ''), `${delBlocked.status} ${delBody.error}`)
```
(The demo host has in-flight bookings too, which also block; the assertion is on the bill wording, so the module must report bills FIRST — see Step 3. If the demo host's other gates fire first, the message assertion fails, which is the point: ordering is part of the contract.)

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/verify/064-bill-routes.mjs 2>&1 | grep -E "account delete"`
Expected: FAIL (either the active-booking wording, or 200 if the demo host has no blockers — in which case STOP: never actually delete the demo host. Guard: run this assertion only if a pre-check `admin('bookings?select=id&host_id=eq.<demo host>&status=in.(pending,confirmed,active)')` is non-empty; otherwise print SKIP. Add that guard now.)

- [ ] **Step 3: Implement the gate**

In `src/lib/account-deletion.ts`:
- Add `issuedBills: number` to `DeletionBlocker`.
- In `checkDeletionEligibility`, after the payout query add a third query:
```ts
  // Eligibility gate: an issued (unpaid) commission bill is real money owed to
  // Rentivo (host commission billing, 061). Deleting would forgive it. Paid and
  // void bills do not block. Bills and items are LEFT UNTOUCHED on deletion:
  // financial records referencing only host_id, no PII.
  const { data: issuedBills, error: billError } = await admin
    .from('host_bills')
    .select('id')
    .eq('host_id', uid)
    .eq('status', 'issued')
```
- Compute `const bills = billError ? 0 : (issuedBills ?? []).length` and report it **first** (before bookings), since it is the gate an admin can clear fastest (void) and the one whose wording the route test asserts:
```ts
  if (bills > 0) {
    return {
      ok: false,
      reason: 'This account has an unpaid commission bill. It must be paid or voided first.',
      blocking: { bookings: refs, pendingPayouts: payouts, issuedBills: bills },
    }
  }
```
- Add `issuedBills: bills` (or `0`) to every other `blocking:` literal in the function (there are five). Add `billError` to the trailing error fall-through in the same shape as `payoutError`.
- Update the module header comment: list the third gate and the "left untouched" decision.

In `src/app/api/account/delete/route.ts`, add before the bookings branch:
```ts
    if (eligibility.blocking.issuedBills > 0) {
      return NextResponse.json(
        { error: 'You have an unpaid commission bill. Please pay it from your Bills page before deleting your account.' },
        { status: 400 }
      )
    }
```
In the admin delete route and the admin user page/component that renders `blocking`, add the same field (`issuedBills`) wherever `pendingPayouts` is constructed or displayed (`grep -rn "pendingPayouts" src/` lists every site; each gets a sibling line, e.g. `{blocking.issuedBills > 0 && <li>{blocking.issuedBills} unpaid commission bill(s)</li>}`).

- [ ] **Step 4: Run both scripts**

Run: `node scripts/verify/061-host-bills.mjs 2>&1 | grep -E "FAIL|PASSED|FAILED"; node scripts/verify/064-bill-routes.mjs 2>&1 | grep -E "FAIL|SKIP|PASSED|FAILED"`
Expected: both `ALL PASSED` (the delete check may print SKIP per the guard; if so, note it in the commit).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/account-deletion.ts src/app/api/account/delete/route.ts "src/app/api/admin/users/[id]/delete/route.ts" "src/app/admin/users/[id]/page.tsx" scripts/verify/061-host-bills.mjs scripts/verify/064-bill-routes.mjs
git commit -m "Block account deletion while a commission bill is unpaid"
```
(Add any component file the grep in Step 3 touched.)

---

### Task 7: Host Bills page and hook

**Files:**
- Create: `src/hooks/useHostBills.ts`
- Create: `src/app/(main)/dashboard/bills/page.tsx`
- Create: `src/components/dashboard/BillPayModal.tsx`
- Modify: `src/components/dashboard/DashboardSidebar.tsx:21` (insert after Earnings)

**Interfaces:**
- Consumes: `HostBill`, `HostBillItem` types; `POST /api/bills/[id]/pay`, `POST /api/bills/[id]/verify-payment`; `periodLabel`, `isOverdue`, `GRACE_DAYS`.
- Produces: `useHostBills(): { bills, loading, outstanding, reload, pay(id): Promise<{ qrImage } | { error }>, verify(id): Promise<'paid'|'processing'|'unpaid'|'error'> }`.

- [ ] **Step 1: Hook**

`src/hooks/useHostBills.ts`:
```ts
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import type { HostBill } from '@/types'

const BILL_SELECT =
  'id, host_id, period, amount, status, issued_at, due_at, paid_at, paymongo_ref, void_reason, created_at, items:host_bill_items(id, bill_id, booking_id, amount, booking:bookings!host_bill_items_booking_id_fkey(booking_ref, pickup_date, return_date, rental_fee, paid_at))'

export function useHostBills() {
  const [bills, setBills] = useState<HostBill[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setBills([])
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setBills([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('host_bills')
      .select(BILL_SELECT)
      .eq('host_id', user.id)
      .order('period', { ascending: false })
    if (!error) setBills((data ?? []) as unknown as HostBill[])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern; no test suite to safely verify a rewrite (see AGENTS.md)
    reload()
  }, [reload])

  const outstanding = useMemo(
    () => bills.filter((b) => b.status === 'issued').reduce((s, b) => s + b.amount, 0),
    [bills]
  )

  async function pay(id: string): Promise<{ qrImage: string } | { error: string }> {
    const res = await fetch(`/api/bills/${id}/pay`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { error: json.error ?? 'Could not start the payment. Please try again.' }
    return { qrImage: json.qrImage as string }
  }

  async function verify(id: string): Promise<'paid' | 'processing' | 'unpaid' | 'error'> {
    const res = await fetch(`/api/bills/${id}/verify-payment`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return 'error'
    return json.status ?? 'unpaid'
  }

  return { bills, loading, outstanding, reload, pay, verify }
}
```
The `bookings` read inside the embed is RLS-scoped to the host's own bookings (they are the host on every billed booking), so the join resolves.

- [ ] **Step 2: Pay modal**

`src/components/dashboard/BillPayModal.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface Props {
  billId: string | null
  qrImage: string | null
  amountLabel: string
  onClose: () => void
  onPaid: () => void
  verify: (id: string) => Promise<'paid' | 'processing' | 'unpaid' | 'error'>
}

/** QR Ph modal for a commission bill. Polls the bill row every 3 s (same
 *  pattern as BookingWizard's qrWaiting) until the webhook marks it paid;
 *  "I've paid" asks PayMongo directly via verify-payment. */
export function BillPayModal({ billId, qrImage, amountLabel, onClose, onPaid, verify }: Props) {
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!billId) return
    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data } = await supabase.from('host_bills').select('status').eq('id', billId).maybeSingle()
      if (data?.status === 'paid') {
        clearInterval(interval)
        onPaid()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [billId, onPaid])

  async function handleVerify() {
    if (!billId) return
    setChecking(true)
    setNote('')
    const s = await verify(billId)
    setChecking(false)
    if (s === 'paid') onPaid()
    else if (s === 'processing') setNote('PayMongo is still processing this payment. Give it a moment.')
    else if (s === 'unpaid') setNote("We couldn't see a payment yet. If you just scanned, wait a few seconds and try again.")
    else setNote("Couldn't check right now. Please try again.")
  }

  return (
    <Dialog open={Boolean(billId && qrImage)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-white p-6 text-center">
        <DialogHeader>
          <DialogTitle className="text-[#111827]">Pay {amountLabel} via QR Ph</DialogTitle>
          <DialogDescription>Scan with any QR Ph-enabled bank or e-wallet app. This page updates automatically once the payment lands.</DialogDescription>
        </DialogHeader>
        {qrImage && <img src={qrImage} alt="QR Ph payment code" className="w-56 h-56 mx-auto rounded-xl" />}
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Waiting for payment…
        </div>
        {note && <p role="alert" className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{note}</p>}
        <div className="flex gap-3 justify-center">
          <button type="button" onClick={handleVerify} disabled={checking} className="text-sm font-semibold text-[#003049] underline disabled:opacity-50">
            {checking ? 'Checking…' : "I've paid — check now"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Page**

`src/app/(main)/dashboard/bills/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { Receipt, ChevronDown, ChevronUp, Loader2, CheckCircle2, Clock, AlertCircle, Ban } from 'lucide-react'
import { useHostBills } from '@/hooks/useHostBills'
import { periodLabel, isOverdue, GRACE_DAYS } from '@/lib/billing'
import { BillPayModal } from '@/components/dashboard/BillPayModal'
import type { HostBill } from '@/types'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`
const date = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
const dateOnly = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}/${y}` }

function StatusPill({ bill }: { bill: HostBill }) {
  if (bill.status === 'paid') return <span className="text-xs bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Paid</span>
  if (bill.status === 'void') return <span className="text-xs bg-gray-100 text-gray-600 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Ban className="w-3 h-3" /> Void</span>
  if (isOverdue(bill)) return <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Overdue</span>
  return <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><Clock className="w-3 h-3" /> Issued</span>
}

export default function BillsPage() {
  const { bills, loading, outstanding, reload, pay, verify } = useHostBills()
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
  const [qr, setQr] = useState<{ billId: string; image: string; amount: number } | null>(null)
  const [error, setError] = useState('')

  async function handlePay(bill: HostBill) {
    setPaying(bill.id)
    setError('')
    const r = await pay(bill.id)
    setPaying(null)
    if ('error' in r) { setError(r.error); return }
    setQr({ billId: bill.id, image: r.qrImage, amount: bill.amount })
  }

  const anyOverdue = bills.some((b) => isOverdue(b))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111827] flex items-center gap-2"><Receipt className="w-6 h-6 text-[#003049]" /> Bills</h1>
        <p className="text-sm text-gray-500 mt-1">5% commission on direct QR bookings, billed monthly. Due {GRACE_DAYS} days after issue.</p>
      </div>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Outstanding</p>
        <p className="mt-1 text-3xl font-bold text-[#003049]">{peso(outstanding)}</p>
        {anyOverdue && (
          <p className="mt-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            You have an overdue bill. Renters can&apos;t pay you by direct QR until it&apos;s settled — your listings stay live through Rentivo&apos;s other payment methods.
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-gray-300 animate-spin" /></div>
      ) : bills.length === 0 ? (
        <p className="text-center text-sm text-gray-500 py-10">No bills yet. You&apos;re only billed for months with direct QR bookings.</p>
      ) : (
        <div className="space-y-3">
          {bills.map((bill) => (
            <div key={bill.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-[#111827]">{periodLabel(bill.period)}</p>
                  <p className="text-xs text-gray-500">Issued {date(bill.issued_at)} · Due {date(bill.due_at)}{bill.paid_at ? ` · Paid ${date(bill.paid_at)}` : ''}</p>
                  {bill.void_reason && <p className="text-xs text-gray-500">Void: {bill.void_reason}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill bill={bill} />
                  <p className="text-lg font-bold text-[#003049]">{peso(bill.amount)}</p>
                  {bill.status === 'issued' && (
                    <button type="button" onClick={() => handlePay(bill)} disabled={paying === bill.id}
                      className="bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                      {paying === bill.id && <Loader2 className="w-4 h-4 animate-spin" />} Pay
                    </button>
                  )}
                  <button type="button" onClick={() => setOpen(open === bill.id ? null : bill.id)} aria-label="Toggle breakdown" className="text-gray-400 hover:text-gray-600">
                    {open === bill.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              {open === bill.id && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="text-xs text-gray-500 border-b border-gray-100"><th className="py-2 pr-3">Booking</th><th className="py-2 pr-3">Dates</th><th className="py-2 pr-3">Paid</th><th className="py-2 pr-3 text-right">Rental</th><th className="py-2 text-right">Fee</th></tr></thead>
                    <tbody>
                      {(bill.items ?? []).map((i) => (
                        <tr key={i.id} className="border-b border-gray-50">
                          <td className="py-2 pr-3 font-medium">{i.booking?.booking_ref ?? '—'}</td>
                          <td className="py-2 pr-3">{i.booking ? `${dateOnly(i.booking.pickup_date)} – ${dateOnly(i.booking.return_date)}` : '—'}</td>
                          <td className="py-2 pr-3">{i.booking?.paid_at ? date(i.booking.paid_at) : '—'}</td>
                          <td className="py-2 pr-3 text-right">{i.booking ? peso(i.booking.rental_fee) : '—'}</td>
                          <td className="py-2 text-right font-semibold">{peso(i.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BillPayModal
        billId={qr?.billId ?? null}
        qrImage={qr?.image ?? null}
        amountLabel={qr ? peso(qr.amount) : ''}
        onClose={() => setQr(null)}
        onPaid={() => { setQr(null); reload() }}
        verify={verify}
      />
    </div>
  )
}
```
Wrap `onPaid` in `useCallback` if the lint rule flags the effect dependency in the modal.

- [ ] **Step 4: Sidebar**

In `DashboardSidebar.tsx`, import `Receipt` (already imported for the renter nav — check) and insert after the Earnings line:
```ts
  { label: 'Bills', href: '/dashboard/bills', icon: Receipt },
```
`/dashboard/bills` is not in the layout's renter-section prefixes, so it renders the host sidebar by default — correct.

- [ ] **Step 5: Browser check**

Dev server on 3100. Insert a probe bill for the demo host with admin (`host_bills` POST: `period '2031-02-01'`, `amount 123`, `due_at` 14 days out) plus one item pointing at any of the demo host's real bookings (`host_bill_items` POST). Sign in as the demo host with Playwright, open `/dashboard/bills`: assert the period label, `₱123`, Issued pill, breakdown row with the booking ref, and that Pay opens the modal with an `<img alt="QR Ph payment code">`. Close. Delete the probe item and bill with admin. Assert `host_bills` count is back to the pre-check value.

- [ ] **Step 6: Typecheck, lint, build, commit**

```bash
npx tsc --noEmit && npm run lint && npm run build 2>&1 | grep -E "rror|Compiled"
git add src/hooks/useHostBills.ts "src/app/(main)/dashboard/bills/page.tsx" src/components/dashboard/BillPayModal.tsx src/components/dashboard/DashboardSidebar.tsx
git commit -m "Add the host Bills page with QR Ph payment"
```

---

### Task 8: Admin Bills page, void route, overview card, reports figures

**Files:**
- Create: `src/app/admin/bills/page.tsx`
- Create: `src/components/admin/BillRunForm.tsx`
- Create: `src/components/admin/BillVoidAction.tsx`
- Create: `src/app/api/admin/bills/[id]/void/route.ts`
- Modify: `src/app/admin/layout.tsx:22` (nav link), `src/app/admin/page.tsx` (card), `src/lib/admin-reports.ts` (`getCommissionTotals`), `src/app/admin/reports/page.tsx` (two cards)
- Modify: `scripts/verify/064-bill-routes.mjs`

**Interfaces:**
- Consumes: `void_host_bill`, `POST /api/admin/bills/run` (Task 3), `periodLabel`, `isOverdue`, `previousPeriod`.
- Produces: `POST /api/admin/bills/[id]/void { reason }` → `{ bill }`; `CommissionTotals` gains `billed: number` (issued + paid amounts) and `billPayments: number` (paid amounts).

- [ ] **Step 1: Extend the route script with failing void checks**

In `064-bill-routes.mjs`, inside the probe-bill `try`, before the webhook replay section, add (a second probe bill so the pay flow's bill stays issued for the webhook):
```js
  const { body: [voidBill] } = await admin('host_bills', { method: 'POST', body: JSON.stringify({ host_id: probeBill.host_id, period: '2031-03-01', amount: 45, due_at: new Date(Date.now() + 864e5).toISOString() }) })
  const vAnon = await fetch(`${APP}/api/admin/bills/${voidBill.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }) })
  check('void route: 404 signed out', vAnon.status === 404, `${vAnon.status}`)
  const vNoReason = await fetch(`${APP}/api/admin/bills/${voidBill.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ reason: ' ' }) })
  check('void route: 400 without a reason', vNoReason.status === 400, `${vNoReason.status}`)
  const vOk = await fetch(`${APP}/api/admin/bills/${voidBill.id}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ reason: 'probe void via route' }) })
  const vOkBody = await vOk.json()
  check('void route: 200 as admin, bill void with reason', vOk.status === 200 && vOkBody.bill?.status === 'void' && vOkBody.bill?.void_reason === 'probe void via route', `${vOk.status} ${JSON.stringify(vOkBody).slice(0, 100)}`)
  await admin(`host_bills?id=eq.${voidBill.id}`, { method: 'DELETE' })
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/verify/064-bill-routes.mjs 2>&1 | grep "void route"`
Expected: three FAILs (404 for all, so the first passes by accident — that is fine; the other two must fail).

- [ ] **Step 3: Void route**

`src/app/api/admin/bills/[id]/void/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: bill, error } = await admin.rpc('void_host_bill', { p_bill_id: id, p_reason: reason })
  if (error || !bill) {
    return NextResponse.json({ error: error?.message ?? 'Void failed.' }, { status: 400 })
  }
  return NextResponse.json({ bill })
}
```

- [ ] **Step 4: Client components**

`src/components/admin/BillRunForm.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BillRunForm({ defaultPeriod }: { defaultPeriod: string /* YYYY-MM */ }) {
  const router = useRouter()
  const [period, setPeriod] = useState(defaultPeriod)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function run() {
    if (!confirm(`Generate commission bills for ${period}? Hosts are emailed immediately. Rerunning a month creates nothing new.`)) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/bills/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period }) })
      const json = await res.json()
      setResult(res.ok ? (json.created === 0 ? 'Nothing to bill for that month.' : `Created ${json.created} bill${json.created === 1 ? '' : 's'}.`) : json.error ?? 'Run failed.')
      if (res.ok) router.refresh()
    } catch {
      setResult('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <label className="text-sm text-gray-600">Month</label>
      <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
      <button type="button" onClick={run} disabled={busy} className="rounded-full bg-[#003049] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? 'Running…' : 'Run billing'}
      </button>
      {result && <p className="text-sm text-gray-700">{result}</p>}
    </div>
  )
}
```
`src/components/admin/BillVoidAction.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BillVoidAction({ billId, amount }: { billId: string; amount: string }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function voidBill() {
    if (!reason.trim()) { setError('A reason is required to void a bill.'); return }
    if (!confirm(`Void this ${amount} bill? Its bookings become billable again on the next run.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bills/${billId}/void`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Void failed.'); return }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
      <button type="button" onClick={voidBill} disabled={busy} className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50">Void</button>
    </div>
  )
}
```

- [ ] **Step 5: Admin page**

`src/app/admin/bills/page.tsx`:
```tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPage } from '@/lib/admin'
import { periodLabel, isOverdue, previousPeriod } from '@/lib/billing'
import { BillRunForm } from '@/components/admin/BillRunForm'
import { BillVoidAction } from '@/components/admin/BillVoidAction'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

type Status = 'issued' | 'overdue' | 'paid' | 'void' | 'all'
interface Row {
  id: string; host_id: string; period: string; amount: number; status: 'issued' | 'paid' | 'void'
  issued_at: string; due_at: string; paid_at: string | null; paymongo_ref: string | null; void_reason: string | null
  profiles: { full_name: string } | null
  host_bill_items: { id: string }[]
}

export default async function AdminBillsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage()
  const { status: raw } = await searchParams
  const status: Status = (['issued', 'overdue', 'paid', 'void', 'all'] as Status[]).includes(raw as Status) ? (raw as Status) : 'issued'

  const admin = createAdminClient()
  let q = admin
    .from('host_bills')
    .select('id, host_id, period, amount, status, issued_at, due_at, paid_at, paymongo_ref, void_reason, profiles!host_bills_host_id_fkey(full_name), host_bill_items(id)')
    .order('issued_at', { ascending: false })
    .limit(500)
  if (status === 'issued' || status === 'overdue') q = q.eq('status', 'issued')
  else if (status !== 'all') q = q.eq('status', status)
  const { data } = await q
  let rows = (data ?? []) as unknown as Row[]
  if (status === 'overdue') rows = rows.filter((r) => isOverdue(r))

  const tabs: Status[] = ['issued', 'overdue', 'paid', 'void', 'all']
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-gray-900">Commission Bills</h1>
        <p className="text-sm text-gray-500">5% service fee on host-QR bookings, billed monthly. The cron runs on the 1st; use Run billing for a missed month or after a void. Rerunning a month never duplicates.</p>
      </div>
      <BillRunForm defaultPeriod={previousPeriod().slice(0, 7)} />
      <div className="flex gap-2 text-sm">
        {tabs.map((t) => (
          <Link key={t} href={`/admin/bills?status=${t}`} className={`rounded-full px-3 py-1 ${status === t ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 shadow-sm'}`}>{t}</Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No {status === 'all' ? '' : status + ' '}bills.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="px-4 py-3">Host</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Bookings</th><th className="px-4 py-3">Issued</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">PayMongo ref</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 align-top">
                  <td className="px-4 py-3"><Link href={`/admin/users/${r.host_id}`} className="font-medium text-[#003049] hover:underline">{r.profiles?.full_name ?? 'Unknown host'}</Link></td>
                  <td className="px-4 py-3">{periodLabel(r.period)}</td>
                  <td className="px-4 py-3 font-semibold">{peso(r.amount)}</td>
                  <td className="px-4 py-3">{r.host_bill_items.length}</td>
                  <td className="px-4 py-3">{date(r.issued_at)}</td>
                  <td className="px-4 py-3">{date(r.due_at)}</td>
                  <td className="px-4 py-3">
                    {r.status === 'paid' ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Paid</span>
                      : r.status === 'void' ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600" title={r.void_reason ?? ''}>Void</span>
                      : isOverdue(r) ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>
                      : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Issued</span>}
                  </td>
                  <td className="px-4 py-3">{date(r.paid_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.paymongo_ref ?? '—'}</td>
                  <td className="px-4 py-3">{r.status === 'issued' && <BillVoidAction billId={r.id} amount={peso(r.amount)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```
Check the FK name `host_bills_host_id_fkey` is what Postgres generated (query `pg_constraint` or inspect the PostgREST error if the embed fails).

- [ ] **Step 6: Nav, overview card, reports figures**

- `src/app/admin/layout.tsx`: add `<Link href="/admin/bills" className="hover:underline">Bills</Link>` after Payouts.
- `src/app/admin/page.tsx`: add an `overdueBills()` helper (`host_bills` where `status = 'issued'` and `due_at < now()`, `count: 'exact', head: true`) and a card `{ label: 'Overdue commission bills', count: overdue, href: '/admin/bills?status=overdue' }`. Widen the grid to `lg:grid-cols-6` or leave it to wrap.
- `src/lib/admin-reports.ts`: extend `CommissionTotals` with `billed: number` and `billPayments: number`; in `getCommissionTotals`, query `host_bills` `select('amount, status')`, `billed = sum where status in ('issued','paid')`, `billPayments = sum where status = 'paid'`.
- `src/app/admin/reports/page.tsx`: after the Uncollected card, add two cards in the same grid (change to `sm:grid-cols-5` or a second row): **Billed** ("Commission bills issued or paid to hosts for host-QR bookings since 5 Sep 2026") and **Bill Payments** ("Collected through commission bills. Uncollected minus this is what is still owed."). Plain white cards, primary blue figure.

- [ ] **Step 7: Run the route script; browser check**

Run: `node scripts/verify/064-bill-routes.mjs 2>&1 | grep -E "FAIL|PASSED|FAILED"` → `ALL PASSED`.
Playwright as the local admin: `/admin/bills` renders (200, tabs, Run billing control, empty-state or rows), `/admin?` shows the new card, `/admin/reports` shows Billed and Bill Payments cards with `₱0`. Signed-out `/admin/bills` → 307; renter → 404 (curl with the renter cookie).

- [ ] **Step 8: Typecheck, lint, build, commit**

```bash
npx tsc --noEmit && npm run lint && npm run build 2>&1 | grep -E "rror|Compiled"
git add src/app/admin/bills/page.tsx src/components/admin/BillRunForm.tsx src/components/admin/BillVoidAction.tsx "src/app/api/admin/bills/[id]/void/route.ts" src/app/admin/layout.tsx src/app/admin/page.tsx src/lib/admin-reports.ts src/app/admin/reports/page.tsx scripts/verify/064-bill-routes.mjs
git commit -m "Add the admin Bills page with run and void, and bill figures on reports"
```

---

### Task 9: Policy copy — `/host-terms`, wizard link, QR card notice

**Files:**
- Create: `src/app/(main)/host-terms/page.tsx`
- Modify: `src/components/host/Step6Verify.tsx:278`
- Modify: `src/components/shared/QrPaymentCard.tsx:60-64`

**Interfaces:**
- Consumes: `POLICY_START_LABEL`, `GRACE_DAYS` from `src/lib/billing.ts`.
- Produces: a public `/host-terms` page.

- [ ] **Step 1: Page**

`src/app/(main)/host-terms/page.tsx`:
```tsx
import Link from 'next/link'
import { POLICY_START_LABEL, GRACE_DAYS } from '@/lib/billing'

export const metadata = { title: 'Host Terms — Rentivo' }

export default function HostTermsPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Host Terms of Service</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated {POLICY_START_LABEL}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Hosting on Rentivo</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>Your identity must be verified by Rentivo before your listings are published.</li>
            <li>Listings must describe equipment you own, accurately, with current photos and a truthful condition.</li>
            <li>Security deposits you set are held for the rental and returned when the equipment comes back as agreed.</li>
            <li>Rentivo charges a 5% service fee on the rental fee of every booking. Delivery fees you set are paid to you in full.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Commission on direct QR payments</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            When a renter pays you through your own GCash or Maya QR code, the full amount — including Rentivo&apos;s 5% service fee — goes straight to your account. That fee is collected from you afterwards:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>On the 1st of each month, Rentivo issues you a bill for the 5% service fee on every direct-QR booking you confirmed as paid in the previous month. Months with no such bookings are not billed.</li>
            <li>Bills are due {GRACE_DAYS} days after they are issued and are paid in-app via QR Ph from your <Link href="/dashboard/bills" className="text-[#003049] underline">Bills page</Link>. You&apos;ll get an email and an in-app notification when one is issued.</li>
            <li>If a bill is still unpaid after its due date, renters can no longer pay you by direct QR until it is settled. Your listings stay live and bookable through Rentivo&apos;s other payment methods.</li>
            <li>This applies to bookings confirmed as paid on or after {POLICY_START_LABEL}.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wizard link and QR card notice**

`Step6Verify.tsx:278`: change `<a href="#" ...>Host Terms of Service</a>` to `<a href="/host-terms" target="_blank" rel="noreferrer" className="text-[#003049] hover:underline">Host Terms of Service</a>`. Leave the Equipment Listing Policy link as is.

`QrPaymentCard.tsx`: after the existing description paragraph, add:
```tsx
      <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
        Bookings paid through your QR are billed the 5% service fee monthly.{' '}
        <a href="/host-terms" target="_blank" rel="noreferrer" className="underline">See Host Terms</a>.
      </p>
```

- [ ] **Step 3: Verify**

`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/host-terms` → 200; `curl -s http://localhost:3100/host-terms | grep -c "September 5, 2026"` → ≥1. Settings page as the demo host shows the notice (Playwright text check).

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/(main)/host-terms/page.tsx" src/components/host/Step6Verify.tsx src/components/shared/QrPaymentCard.tsx
git commit -m "Publish host terms with the commission billing policy"
```

---

### Task 10: Whole-feature verification, docs, deploy

**Files:**
- Modify: `AGENTS.md` (repo map lines for 061–063, a Status entry, the Payments/host-QR architecture note, the account-deletion bullet, the "Revenue-collection caveat" line in the 035 entry, the "Known residual gap" style line in the host-QR entry, To Do)
- Vercel: `CRON_SECRET` env var; deploy.

- [ ] **Step 1: Full regression**

Run in order: `node scripts/verify/061-host-bills.mjs`, `node scripts/verify/064-bill-routes.mjs` (dev server on 3100), `node scripts/verify/checkout-disabled-method.mjs http://localhost:3100`, `node scripts/verify/060-drop-messages-booking-id.mjs`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. All must pass/clean. Stop the dev server before `npm run build`.

- [ ] **Step 2: Grant audit and baseline**

Re-run Task 1 Step 6's audit query; re-run a read-only baseline (`host_bills` 0, `host_bill_items` 0 — nothing real is billable before 2026-09-05; bookings/conversations/messages/notifications at their known counts; forbidden host present).

- [ ] **Step 3: AGENTS.md**

- Repo map: add `061 host commission billing ledger + RPCs + enforcement trigger`, `062 bill_issued notification type`, `063 generate_host_bills notifies`.
- Architecture: a new **Host commission billing** bullet (model, eligibility, the three RPCs, the helper, the trigger, cron + admin run, pay route + webhook branch, the deletion gate, and the three "do not" rules: never edit `create_booking`; `POLICY_START` lives in exactly two places; `host_bills` has no client write grants).
- Account-deletion bullet: list `host_bills`/`host_bill_items` as "left untouched" and the third gate.
- The 035 entry's "Revenue-collection caveat ... not yet acted on" line: append "— acted on 2026-09-04 by the host commission billing workstream (temporary, see that Status entry)".
- Status entry: what was built, what was verified (quote the script names and counts), what was NOT (email delivery, a real QR Ph scan, the cron actually firing on the 1st), and the retirement note.
- To Do: `CRON_SECRET` in Vercel (done in Step 4, tick it in the same edit), and "retire host commission billing once PayMongo activates GCash/Maya/card" as a new open item.

- [ ] **Step 4: Vercel env + deploy**

`vercel env add CRON_SECRET production` (paste the same value as `.env.local`, or a fresh `openssl rand -hex 32` — they need not match). Then `git push origin main && vercel deploy --prod --yes`. Confirm `vercel ls --prod` shows Ready, and that the Vercel dashboard's Cron Jobs tab lists `/api/cron/host-bills` (or `vercel crons ls` if the CLI supports it). Production checks: `/host-terms` 200; `/api/cron/host-bills` 401 without the secret; `/admin/bills` 307 signed out; `/dashboard/bills` 307 signed out; home and a listing page 200.

- [ ] **Step 5: Commit and push docs**

```bash
git add AGENTS.md
git commit -m "Document host commission billing; record the 2026-09-04 deploy"
git push origin main
```

---

## Self-review

**Spec coverage.** Data model (Task 1, 2), eligibility rule (Task 1), RPCs + helper + trigger (Task 1), notification (Task 2), account deletion (Task 6), cron + admin run + email + env (Task 3), pay + webhook + polling + verify (Task 4, 7), enforcement UI (Task 5), host page (Task 7), admin page + overview + reports (Task 8), policy copy in three places (Task 9), testing list items 1–9 (Tasks 1, 2, 4, 6, 7, 8, 9, 10), retirement note (Task 10). Gap check: the spec's admin `/admin/bills` "host link to `/admin/users/[id]`" — in Task 8. The spec's "Rerunning a month never duplicates" copy — in the BillRunForm confirm and page caption.

**Placeholders.** None: every code step carries the code. Task 5 Step 3 deliberately does not fabricate a delinquent real host and says so.

**Type consistency.** `HostBill`/`HostBillItem` (Task 2) are what `useHostBills` (Task 7), `BillPayModal` (Task 7), the admin page's `Row` (Task 8, a narrower local shape), and the routes (Tasks 3, 4) use. `previousPeriod()` returns `'YYYY-MM-01'`; `BillRunForm` takes `'YYYY-MM'` (`previousPeriod().slice(0, 7)`) and the run route normalizes with `normalizePeriod`. `verify()` returns the same four-string union in the hook and the modal. `is_host_billing_delinquent(p_host_id uuid)` is called with `{ p_host_id }` everywhere.
