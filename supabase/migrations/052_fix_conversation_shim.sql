-- Rentivo — Fix round 1 on 051's conversation shim (051 is already applied to
-- the live database, so this is a NEW migration rather than an edit to 051).
--
-- Ordering rule: every function/trigger (re)definition below comes BEFORE any
-- data backfill, and this migration adds no new constraints. That matters
-- because `supabase db push` applies a migration file in one transaction, but
-- this repo's documented "replay statement-by-statement in the SQL editor"
-- workflow does not get that guarantee — if a future migration in this style
-- ever tightens a constraint, put the function/trigger (re)definitions before
-- it in the file, never after, so there is no window where the constraint is
-- live and the compatibility shim is not.

-- Finding B (the real hole): fill_conversation_from_booking()'s `select ...
-- into` assigns NULL, without raising, when zero rows match. That is not a
-- hypothetical — 050 backfilled conversations from a snapshot, and the
-- create-on-booking trigger for NEW bookings doesn't land until Task 5. Any
-- booking created on the live site in that window has no conversation row,
-- and every message on it (old client AND new client) would 23502 forever.
--
-- Fix: on lookup miss, create the missing conversation right here instead of
-- just failing to fill the id. Already security definer; conversations.booking_id
-- is unique, so `on conflict (booking_id) do nothing` makes this a safe upsert
-- even if a concurrent insert is doing the same thing for the same booking.
create or replace function public.fill_conversation_from_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.conversation_id is null and new.booking_id is not null then
    select c.id into new.conversation_id
      from public.conversations c
     where c.booking_id = new.booking_id;

    if new.conversation_id is null then
      -- No conversation exists yet for this booking (created between 050's
      -- one-shot backfill and Task 5's create-on-booking trigger). Create it
      -- now rather than leaving conversation_id null, so messaging on this
      -- booking never depends on Task 5 having landed first.
      insert into public.conversations (listing_id, renter_id, host_id, booking_id)
      select b.listing_id, b.renter_id, b.host_id, b.id
        from public.bookings b
       where b.id = new.booking_id
      on conflict (booking_id) do nothing
      returning id into new.conversation_id;

      if new.conversation_id is null then
        -- Lost a race with a concurrent insert creating the same booking's
        -- conversation — pick up the row it just created.
        select c.id into new.conversation_id
          from public.conversations c
         where c.booking_id = new.booking_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Important 2: last_message_at was being set from the client-supplied
-- messages.created_at (004 grants table-level insert on messages with no
-- column restriction, so a participant can forge it), letting anyone pin a
-- conversation to the top of both inboxes forever with a future timestamp.
-- Use the server's clock instead, which is exactly this trigger's stated
-- purpose ("keep thread ordering server-side so a client cannot forge it").
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

-- Belt-and-braces: re-run 050's backfill. It is written `where not exists
-- (...)`, so it is idempotent, and it closes any gap that already opened
-- between 050 running and this migration landing (the same gap Finding B's
-- fix closes going forward for every future insert).
insert into public.conversations (listing_id, renter_id, host_id, booking_id, created_at, last_message_at)
select b.listing_id,
       b.renter_id,
       b.host_id,
       b.id,
       b.created_at,
       coalesce((select max(m.created_at) from public.messages m where m.booking_id = b.id), b.created_at)
from public.bookings b
where not exists (select 1 from public.conversations c where c.booking_id = b.id);
