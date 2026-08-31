-- 028_host_qr_payment.sql
-- Lets a host accept payment via their own GCash/Maya "receive money" QR
-- code instead of PayMongo. The renter pays the host directly — Rentivo
-- never touches this money, so there's no webhook to confirm it; the host
-- self-reports receipt via confirm_host_qr_payment. See
-- docs/superpowers/specs/2026-08-31-host-qr-payment-design.md.

alter table public.profiles
  add column qr_payment_url   text,
  add column qr_payment_label text;

-- profiles uses column-level grants (004), not a blanket "update own row"
-- policy — every self-editable column must be explicitly granted or the
-- update is rejected outright. Mirrors 010's/025's pattern of extending
-- this same grant when new self-editable profile columns are added.
grant update (qr_payment_url, qr_payment_label) on public.profiles to authenticated;

-- Private bucket: a GCash/Maya "receive" QR isn't acutely sensitive (it's
-- designed to be shown to accept payment) but there's no reason to let it
-- be scraped off a public endpoint either. <uid>/<uuid>.<ext> paths,
-- folder-scoped policies — same shape as message-images (019) but private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('payment-qr-codes', 'payment-qr-codes', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "payment-qr-codes: own folder read"
  on storage.objects for select
  using (bucket_id = 'payment-qr-codes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "payment-qr-codes: own folder write"
  on storage.objects for insert
  with check (bucket_id = 'payment-qr-codes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "payment-qr-codes: own folder delete"
  on storage.objects for delete
  using (bucket_id = 'payment-qr-codes' and auth.uid()::text = (storage.foldername(name))[1]);

-- Mirrors mark_booking_paid's (009) transition logic exactly — instant-book
-- listings flip pending -> confirmed, non-instant stays pending for the
-- host to separately Accept — but authenticated + self-scoped instead of
-- service_role-only, since there's no external processor confirming the
-- charge: the host's own claim *is* the confirmation.
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
