-- Rentivo — Pre-booking inquiries: the conversations table.
--
-- A message thread has always been IMPLIED by a booking (messages.booking_id is
-- not null). That makes it impossible to message a host before booking, which
-- is the whole point of this feature. A conversation row makes the thread a
-- first-class object, so attaching it to a booking later is one field update.

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  renter_id       uuid not null references public.profiles(id),
  host_id         uuid not null references public.profiles(id),
  -- ON DELETE CASCADE, deliberately. messages.booking_id is already
  -- `on delete cascade` today, so deleting a booking ALREADY destroys its
  -- messages; cascade preserves that exactly. `set null` would quietly change
  -- it (messages would survive as an orphaned inquiry) AND could violate
  -- conversations_open_inquiry_key below by turning an attached conversation
  -- back into an open one that collides with an existing inquiry.
  booking_id      uuid unique references public.bookings(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- At most one OPEN inquiry per renter+listing. PARTIAL is load-bearing: an
-- unconditional unique(listing_id, renter_id) would fail on existing data,
-- because 4 bookings already share such a pair (the same renter has rented the
-- same gear more than once). Attached conversations are exempt, so every
-- booking — including a repeat rental — gets its own thread.
create unique index conversations_open_inquiry_key
  on public.conversations (listing_id, renter_id)
  where booking_id is null;

create index conversations_renter_idx  on public.conversations(renter_id);
create index conversations_host_idx    on public.conversations(host_id);
create index conversations_listing_idx on public.conversations(listing_id);

-- NON-NEGOTIABLE, same migration as the create. This project grants broad
-- write access to anon/authenticated on every public table regardless of what
-- migrations say, so a table without RLS is world-writable immediately.
alter table public.conversations enable row level security;

-- Read: the two participants only.
create policy "conversations: participants read"
  on public.conversations for select
  using (auth.uid() = renter_id or auth.uid() = host_id);

-- No insert/update/delete policy at all, on purpose. Writes happen only in
-- create_inquiry() and the booking trigger (053), both security definer, which
-- bypass RLS as the function owner. RLS default-deny covers everything else.

-- Explicit Data API grants; without these PostgREST 403s. Note we grant SELECT
-- only, and REVOKE the writes this project's bootstrap may already have handed
-- out — a table-level grant would otherwise satisfy any write.
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
