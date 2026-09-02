-- Rentivo — Harden message inserts: derive booking_id FROM the conversation.
--
-- Fix round 1 review finding (IMPORTANT 1) on migration 053: dropping the old
-- bookings-pivoted INSERT policy in favor of a conversations-pivoted one left
-- nothing validating a client-supplied booking_id against conversation_id.
-- 004 grants table-level insert on messages with no column list, so a client
-- fully controls booking_id. Attack: POST
--   {conversation_id: <own conversation>, booking_id: <a stranger's booking>,
--    sender_id: <self>, content: "..."}
-- RLS accepts it (it only checks conversation membership + sender_id). Both
-- parties' own reads correctly hide the row (it isn't in their conversation),
-- which is exactly why this is easy to miss — but notifyNewMessage() (called
-- from POST /api/messages/notify, which the real sender passes the auth check
-- for) resolves the recipient from message.booking_id on the ADMIN client,
-- so Rentivo would email the attacker's text to an unrelated stranger from
-- noreply@rentivo.live.
--
-- Fix: never trust a client-supplied booking_id. After conversation_id is
-- resolved (either supplied directly, or filled from booking_id for the old
-- client shape), ALWAYS overwrite booking_id from the conversation's own
-- value. This also makes a conversation_id/booking_id mismatch structurally
-- impossible, which matters because Task 11 drops the booking_id column and
-- a lingering mismatch would otherwise be silently papered over until then.
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

  -- Always derive booking_id FROM the conversation, overwriting whatever the
  -- client sent (including a client-supplied conversation_id from the new
  -- shape, once that ships) — see the header note above for why this is
  -- load-bearing, not defensive-only.
  if new.conversation_id is not null then
    select c.booking_id into new.booking_id
      from public.conversations c
     where c.id = new.conversation_id;
  end if;

  return new;
end;
$$;

-- MINOR (promoted): give the UPDATE policy an explicit WITH CHECK mirroring
-- its USING predicate. Postgres reuses USING for WITH CHECK when none is
-- given, so this is a no-op today — but the row's post-update safety
-- currently rests entirely on the grant list staying exactly `(is_read)`,
-- and a future migration widening that grant would silently widen what a
-- participant can rewrite. An explicit WITH CHECK is a second, independent
-- backstop that doesn't depend on remembering the grant list is minimal.
drop policy if exists "messages: participants update" on public.messages;

create policy "messages: participants update"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );
