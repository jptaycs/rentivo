-- Rentivo — One conversation per pre-existing booking.
--
-- Runs BEFORE messages.conversation_id exists (051), so every message has a
-- conversation to point at when that column is backfilled.
--
-- No conflict handling is needed or wanted: conversations_open_inquiry_key is
-- PARTIAL (where booking_id is null) and every row inserted here has
-- booking_id set, so repeat rentals of the same listing by the same renter
-- each get their own row. If this statement ever raises a unique violation,
-- the index was created unconditionally — fix the index, do not add ON CONFLICT.

insert into public.conversations (listing_id, renter_id, host_id, booking_id, created_at, last_message_at)
select b.listing_id,
       b.renter_id,
       b.host_id,
       b.id,
       b.created_at,
       coalesce((select max(m.created_at) from public.messages m where m.booking_id = b.id), b.created_at)
from public.bookings b
where not exists (select 1 from public.conversations c where c.booking_id = b.id);
