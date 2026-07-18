-- ============================================================
-- Rentivo — Refund tracking
-- Mirrors mark_booking_paid: service-role-only, idempotent, the
-- only path to payment_status = 'refunded'.
-- ============================================================

alter table public.bookings add column refund_ref text;

create or replace function public.mark_booking_refunded(
  p_booking_id  uuid,
  p_refund_ref  text default null
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.payment_status = 'refunded' then
    return v_booking;  -- idempotent — a retried refund call is a no-op
  end if;
  if v_booking.payment_status != 'paid' then
    raise exception 'Only paid bookings can be refunded.';
  end if;

  update public.bookings
  set payment_status = 'refunded',
      refund_ref     = coalesce(p_refund_ref, refund_ref)
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function public.mark_booking_refunded(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_booking_refunded(uuid, text) to service_role;
