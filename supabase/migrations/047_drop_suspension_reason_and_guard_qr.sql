-- ============================================================
-- 047_drop_suspension_reason_and_guard_qr.sql
-- Two gaps found re-reviewing 045/046.
--
-- 1. profiles.suspension_reason (added by 044) is WORLD-READABLE. `profiles`
--    carries `public read using (true)`, so anon can select the column straight
--    off the table via raw PostgREST — verified before this migration was
--    written. It is admin-authored free text ABOUT a user: the single worst
--    shape of data to leave on a publicly readable row.
--
--    A column-level revoke is NOT the fix. This project's documented finding
--    (AGENTS.md, the 040 write-up) is that a table-level grant satisfies a write
--    or read to ANY column, so column-level grants only ever add, never narrow.
--    Closing it properly would mean revoking table-level SELECT on `profiles`,
--    which every public read path in the app depends on — far more risk than the
--    column is worth.
--
--    So the column is dropped instead, because it is redundant rather than
--    merely inconvenient. The reason a user was suspended belongs in
--    `admin_actions.detail` (044) — service-role only, RLS-denied to everyone
--    else — written by the suspend route, and it is sent to the user in the
--    suspension email. Nothing needs it on `profiles`.
--
--    DO NOT RE-ADD THIS COLUMN. If a future feature needs the reason on the
--    profile row, it needs a different home or a genuinely narrowed read path
--    first; putting free text about a user back onto a `using (true)` table
--    re-opens exactly this hole. `suspended_at` stays — it is the enforcement
--    flag every read path checks, and it discloses only a boolean-equivalent
--    fact about a listing that has already left the marketplace.
--
--    Verified before writing this: zero rows hold a non-null suspension_reason
--    and zero profiles are suspended, so the drop destroys no data.
--
-- 2. confirm_host_qr_payment let a suspended host mark their own booking paid —
--    the third money path in the same class as create_booking (045) and
--    request_payout (046).
-- ============================================================

-- ── 1. Drop the column ───────────────────────────────────────────
alter table public.profiles drop column if exists suspension_reason;

-- ── 2. confirm_host_qr_payment ───────────────────────────────────
-- Body copied verbatim from 030 (the later of the two definitions: 028 created
-- it, 030 replaced it to make the payment_method guard NULL-safe; nothing after
-- 030 touches it). The ONLY change is the suspension guard marked "047:".
--
-- The guard sits after the authentication check and before the host check, so
-- it reads on auth.uid() exactly as request_payout's does. Like that one — and
-- unlike create_booking's — it names the reason: the caller here is the
-- suspended host themselves, so there is nothing disclosed they don't know.
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

  -- 047: a suspended host cannot settle their own bookings. This is the third
  -- money path guarded, after create_booking (045) and request_payout (046);
  -- without it a suspended host could still mark a QR booking paid, which
  -- confirms the rental and (for instant-book listings) advances it to
  -- confirmed.
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.suspended_at is not null
  ) then
    raise exception 'Your account is suspended. You cannot confirm payments — contact support.';
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
  if v_booking.payment_method is distinct from 'host_qr' then
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

-- Grants reissued exactly as 030 had them (create or replace preserves them,
-- but restating makes the intended reachability explicit).
revoke execute on function public.confirm_host_qr_payment(uuid) from public, anon;
grant execute on function public.confirm_host_qr_payment(uuid) to authenticated;
