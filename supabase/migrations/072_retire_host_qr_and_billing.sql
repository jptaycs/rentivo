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
-- (061 actually named the trigger bookings_block_delinquent_host_qr, not
-- block_delinquent_host_qr as this migration originally assumed — the
-- function name and the trigger name are not the same string.)
drop trigger if exists bookings_block_delinquent_host_qr on public.bookings;
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
