-- ============================================================
-- Rentivo — In-app notifications
-- Rows are written only by trigger functions (security definer),
-- never directly by clients — users can only read/mark their own.
-- ============================================================

create type notification_type as enum (
  'booking_request', 'booking_confirmed', 'booking_cancelled',
  'booking_completed', 'booking_paid', 'review_received'
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        notification_type not null,
  title       text not null,
  body        text not null,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications: own read"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "notifications: own update"
  on public.notifications for update
  using (auth.uid() = user_id);

grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
-- No insert grant: rows are written only by the trigger functions below.

-- ───────────────────────────────────────────────────────────
-- Bookings: new request + status/payment transitions
-- ───────────────────────────────────────────────────────────

create or replace function public.notify_new_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  v_title := (select brand || ' ' || model from public.listings where id = new.listing_id);
  if new.status = 'confirmed' then
    insert into public.notifications (user_id, type, title, body, link)
    values (new.host_id, 'booking_confirmed', 'New Instant Book',
      coalesce(v_title, 'A listing') || ' was just booked (' || new.booking_ref || ').',
      '/dashboard/bookings');
  else
    insert into public.notifications (user_id, type, title, body, link)
    values (new.host_id, 'booking_request', 'New booking request',
      'You have a new request for ' || coalesce(v_title, 'your listing') || ' (' || new.booking_ref || ').',
      '/dashboard/bookings');
  end if;
  return new;
end;
$$;

create trigger bookings_notify_insert
  after insert on public.bookings
  for each row execute procedure public.notify_new_booking();

create or replace function public.notify_booking_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'confirmed' and old.status = 'pending' then
      insert into public.notifications (user_id, type, title, body, link)
      values (new.renter_id, 'booking_confirmed', 'Booking confirmed',
        'Your booking ' || new.booking_ref || ' has been confirmed by the host.', '/dashboard/rentals');
    elsif new.status = 'cancelled' then
      if auth.uid() = old.renter_id then
        insert into public.notifications (user_id, type, title, body, link)
        values (new.host_id, 'booking_cancelled', 'Booking cancelled',
          'The renter cancelled booking ' || new.booking_ref || '.', '/dashboard/bookings');
      else
        insert into public.notifications (user_id, type, title, body, link)
        values (new.renter_id, 'booking_cancelled', 'Booking declined',
          'Your booking ' || new.booking_ref || ' was declined.', '/dashboard/rentals');
      end if;
    elsif new.status = 'completed' then
      insert into public.notifications (user_id, type, title, body, link)
      values (new.renter_id, 'booking_completed', 'Rental completed',
        'Your rental ' || new.booking_ref || ' is complete — leave a review for the host.', '/dashboard/rentals');
    end if;
  end if;

  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    insert into public.notifications (user_id, type, title, body, link)
    values (new.host_id, 'booking_paid', 'Payment received',
      '₱' || new.rental_fee::text || ' payment received for booking ' || new.booking_ref || '.', '/dashboard/earnings');
  end if;

  return new;
end;
$$;

create trigger bookings_notify_update
  after update on public.bookings
  for each row execute procedure public.notify_booking_update();

-- ───────────────────────────────────────────────────────────
-- Reviews: notify the reviewee
-- ───────────────────────────────────────────────────────────

create or replace function public.notify_new_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  values (new.reviewee_id, 'review_received', 'New review received',
    'You received a ' || new.rating || '-star review.', '/dashboard/reviews');
  return new;
end;
$$;

create trigger reviews_notify_insert
  after insert on public.reviews
  for each row execute procedure public.notify_new_review();
