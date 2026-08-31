# Host QR-Code Payment — Design

**Date:** 2026-08-31
**Status:** Approved

## Goal

Let a host accept payment directly via their own GCash/Maya "receive money" QR code as an alternative to PayMongo (GCash/Maya/Card) at checkout. The renter pays the host's personal account directly; Rentivo never touches the money, so there's no webhook to confirm it — the host self-reports receipt with a "Mark payment received" action, mirroring the trust model already used for `mark_booking_paid`'s PayMongo confirmation but scoped to the host instead of `service_role`.

## Decisions (made with user)

- **Who confirms payment:** the host self-reports ("I received this payment"). No admin review step — unlike identity verification or payout accounts, a false claim here mainly hurts the host themselves (they hand over equipment for a rental period they were never actually paid for), so the fraud incentive against Rentivo specifically is weak. This keeps the MVP simple: no proof-upload, no dispute queue.
- **Checkout placement:** a new tile in the existing GCash/Maya/Card/Apple Pay/Google Pay selector in `Step3Payment.tsx`, shown only when the listing's host has a QR uploaded.
- **QR management:** Settings only (like the existing `VerificationCard`/payout-account card) — not part of the host wizard. It's a standing payment preference, not something tied to publishing a specific listing.
- **Fee handling:** the QR covers the *full* `total_amount` (rental fee + security deposit + service fee + protection fee), paid straight to the host. Rentivo earns nothing on these bookings and never holds the deposit. This is the simplest MVP shape and matches how a renter would actually use a QR code in real life — splitting the charge across two payment rails (QR for rental+deposit, PayMongo for the platform fee) was rejected as unrealistic complexity for a feature meant to be a lightweight escape hatch.

## Data model

New migration `027_host_qr_payment.sql`.

```sql
alter type public.payment_method add value if not exists 'host_qr';
```

(Postgres requires `alter type ... add value` to run in its own transaction/statement — this line is the entire first statement of the migration, matching how prior migrations that touched enums structured themselves.)

```sql
alter table public.profiles
  add column qr_payment_url   text,
  add column qr_payment_label text;

-- profiles uses column-level grants (004), not a blanket "update own row"
-- policy — every self-editable column must be explicitly granted or the
-- update is rejected outright. Mirrors 010's/025's pattern of extending
-- this same grant when new self-editable profile columns are added.
grant update (qr_payment_url, qr_payment_label) on public.profiles to authenticated;
```

No new table. `qr_payment_url` stores the storage **path** (not a public URL — the bucket is private, see below); `qr_payment_label` is host-typed free text shown next to the QR image so the renter knows what they're scanning (e.g. `"GCash — Juan Dela Cruz, 09XX XXX XXXX"`). Both columns are nullable; a host with `qr_payment_url is null` simply never shows the QR tile at checkout. The RLS policy on `profiles` itself is unchanged (existing "update own row" policy already scopes every grantable column to `auth.uid() = id`); only the column-level grant above is new.

**Storage:** new private bucket `payment-qr-codes`, mime/size-limited to images (mirrors `avatars`/`verification-docs`), paths scoped `<uid>/<uuid>.<ext>` with a folder-scoped write policy (`storage.foldername(name)[1] = auth.uid()::text`), same pattern as every other bucket in this project. Bucket creation + policies live in the same migration.

## Why this doesn't need a `host_qr_accounts`-style table

`payout_accounts` needed its own table because it has a real state machine (`pending → verified/rejected`) driven by manual admin review, since Rentivo actually disburses money against it. A host's payment QR has none of that: nobody at Rentivo verifies it, no money flows through Rentivo because of it, and there's exactly one per host with no history to preserve. Two nullable columns on `profiles` are the entire data model.

## RPC: `confirm_host_qr_payment`

```sql
create or replace function public.confirm_host_qr_payment(p_booking_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_booking public.bookings;
  v_instant boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.host_id <> auth.uid() then
    raise exception 'Only the host can confirm this payment.';
  end if;
  if v_booking.payment_method <> 'host_qr' then
    raise exception 'This booking is not paid via QR.';
  end if;
  if v_booking.payment_status = 'paid' then
    return v_booking;  -- idempotent, same as mark_booking_paid
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'Cannot mark a cancelled booking as paid.';
  end if;

  select is_instant_book into v_instant
  from public.listings
  where id = v_booking.listing_id;

  update public.bookings
  set payment_status = 'paid',
      paid_at        = now(),
      status         = case
                         when coalesce(v_instant, false) and status = 'pending'
                         then 'confirmed'::booking_status
                         else status
                       end
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function public.confirm_host_qr_payment(uuid) from public, anon;
grant execute on function public.confirm_host_qr_payment(uuid) to authenticated;
```

This deliberately mirrors `mark_booking_paid`'s transition logic exactly (009): instant-book listings flip `pending → confirmed`; non-instant listings stay `pending` and the host still separately Accepts through the existing `/api/bookings/[id]/respond` flow, same two-step as a PayMongo-paid non-instant booking today. The only differences from `mark_booking_paid` are (a) it's `authenticated`-granted and self-scoped via `auth.uid() = host_id` instead of `service_role`-only, since there's no external payment processor confirming the charge — the host's own claim *is* the confirmation — and (b) it does not set `paymongo_ref` (there is none).

## Checkout flow

`Step3Payment.tsx`'s `METHODS` array gains a 6th entry, shown conditionally — the listing/host data passed into the component needs `host.qr_payment_url`/`host.qr_payment_label` (already fetched via `HOST_SELECT` in `src/lib/hosts.ts` / `src/lib/listings.ts`; add the two columns there). Selecting the tile replaces the GCash/card fields with:

- The fetched QR image (via `GET /api/bookings/[id]/qr`, see below — fetched only *after* the booking exists, since the route needs a real booking to authorize against)
- `qr_payment_label` displayed as plain text
- A clear notice: *"You'll pay ₱{total} directly to the host via this QR. Rentivo doesn't process or hold this payment — your host will confirm they've received it."*
- The existing terms checkbox, unchanged

Because there's no PayMongo intent, this path does **not** go through `/api/payments/checkout`. It calls `create_booking` directly client-side with `p_payment_method: 'host_qr'` — `create_booking` is already `authenticated`-granted and other RPCs (`validate_promo_code`) are already called this way from `Step3Payment.tsx`, so this isn't a new pattern. Once the booking exists (`pending` + `unpaid`), the QR image is fetched and shown, and the renter is routed to a confirmation state that says payment is awaiting the host's confirmation — no fake "processing", no PayMongo receipt. This is a real UX difference from the other four methods (which pay immediately) and needs its own confirmation copy/state in the booking flow's final step, not a reuse of the "Booking Confirmed!" copy used for immediate PayMongo success.

## QR image access

Never public. New route `GET /api/bookings/[id]/qr`:
1. Auth-checks the caller via the server Supabase client.
2. Loads the booking; 404 if the caller is neither `renter_id` nor `host_id`.
3. 400 if `payment_method <> 'host_qr'`.
4. Loads the host's `qr_payment_url` from `profiles`; 404 if null.
5. Returns a short-lived signed URL (`createSignedUrl`, same call shape as the existing `verification-docs` signed-URL usage) for that storage path.

This scopes visibility to exactly the two parties in a real booking — nobody can browse a host's QR by guessing a listing or host id.

## Host confirms payment

A "Mark payment received" button on the host's booking-detail view (`/dashboard/bookings`), shown only when `payment_method === 'host_qr' && payment_status === 'unpaid' && status !== 'cancelled'`. Calls `confirm_host_qr_payment(booking_id)` directly client-side (same direct-RPC pattern as `request_payout()` elsewhere in the dashboard). On success, the booking's displayed status updates in place; for non-instant listings this does **not** auto-accept — the existing Accept/Decline UI still applies afterward, unchanged.

## Payout interaction

`request_payout()` (migration 021) must exclude `host_qr` bookings from its eligibility CTE — the host already received that money directly, so counting it again would double-pay them through Rentivo's manual payout process. One-line change to the `eligible` CTE's `where` clause:

```sql
and b.payment_method <> 'host_qr'
```

New migration `028_exclude_qr_from_payouts.sql`, `create or replace function public.request_payout()` with this one added predicate, otherwise byte-identical to 021.

## Refund interaction

**No code change needed in `src/lib/refunds.ts`.** Traced through the existing logic: a `host_qr` booking has `paymongo_ref = null` (never set, since no PayMongo intent is ever created for this path). `refundBooking()` already treats a missing `paymongo_ref` as "nothing to refund via PayMongo" and short-circuits straight to `mark_booking_refunded`, marking `payment_status = 'refunded'` in Rentivo's own records without attempting a real refund call. This is exactly the right behavior for `host_qr` — Rentivo genuinely cannot refund money it never held.

**Copy change needed:** `notifyBookingResponded`'s cancellation email currently frames a successful `refundBooking()` result as "your payment has been refunded," which is misleading for `host_qr` bookings — no money moved through Rentivo, so nothing was actually refunded on Rentivo's end. Add a branch keyed on `booking.payment_method === 'host_qr'`: instead of claiming a refund happened, the copy should say the booking was cancelled and the host will need to refund the renter directly (or vice versa, depending on who's being notified), since that money exchange happened entirely off-platform.

## Settings UI

A new card in Settings, styled after the existing `VerificationCard`: an image upload (replace-not-append, one QR per host) plus a text input for `qr_payment_label`. No approval workflow — saves and takes effect immediately, same responsiveness as the existing notification-preference toggles. A "Remove" action clears both columns and deletes the storage object (non-fatal if the storage delete fails, matching the account-deletion route's existing log-and-continue pattern for storage cleanup).

## Security model

- `alter table ... enable row level security` is **not** needed for the `profiles` column additions (rides the existing policy) but **is** required for the new `payment-qr-codes` storage bucket's policies, per AGENTS.md's standing rule that any new privilege surface needs RLS/policies enabled in its own creation migration — non-negotiable given this project's documented finding that Supabase silently grants broad table privileges independent of explicit `grant`s.
- `confirm_host_qr_payment` is `authenticated`-granted but internally scoped to `auth.uid() = host_id` — a renter or unrelated user calling it on someone else's booking gets a raised exception, not a silent no-op, matching the explicit-error style of `mark_booking_paid`/`confirm` RPCs elsewhere in this codebase.
- The QR image itself is not especially sensitive in isolation — a GCash/Maya "receive" QR is designed to be shown publicly to accept payment, the way a payment QR sticker in a shop window is. The signed-URL gating in `GET /api/bookings/[id]/qr` is still worth doing (avoids casual scraping of every host's payment QR off a public endpoint, which is unnecessary exposure even if not acutely dangerous) but this is a lower sensitivity bar than `verification-docs`.

## Out of scope for this pass

- Any dispute-resolution or proof-of-payment upload flow if a host and renter disagree about whether payment was actually sent.
- Automated deposit refund on completion — this doesn't exist for any payment method in the app today (traced: no "return deposit" RPC exists anywhere in the schema), so `host_qr` isn't regressing anything by also not having it.
- Letting a host use `host_qr` for *some* bookings and PayMongo for others on the same listing selectively — this is naturally already possible since payment method is chosen per-booking by the renter at checkout (a host doesn't "opt in" a listing to QR payments, they just upload a QR and it becomes an available renter-chosen option wherever their listings appear), so no extra toggle is needed.
