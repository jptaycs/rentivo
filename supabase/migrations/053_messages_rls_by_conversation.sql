-- Rentivo — Move messages RLS from bookings to conversations.
--
-- All THREE policies are replaced. The UPDATE policy (added in 013) is what
-- makes read receipts work; dropping it without a replacement fails silently,
-- because an UPDATE with no matching policy changes 0 rows without erroring.

drop policy if exists "messages: participants read"   on public.messages;
drop policy if exists "messages: participants insert" on public.messages;
drop policy if exists "messages: participants update" on public.messages;

create policy "messages: participants read"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

create policy "messages: participants insert"
  on public.messages for insert
  with check (
    auth.uid() = sender_id and
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

create policy "messages: participants update"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.renter_id = auth.uid() or c.host_id = auth.uid())
    )
  );

-- Migration 040's lesson: a TABLE-LEVEL update grant satisfies a write to any
-- column, which would make 013's `grant update (is_read)` decorative and let a
-- participant rewrite content or sender_id on someone else's message. Revoke
-- first, then re-grant exactly the one column the app writes. (Pre-migration
-- verification proved this is load-bearing, not belt-and-braces: the tamper
-- check failed against the live database before this revoke was applied.)
revoke update on public.messages from anon, authenticated;
grant update (is_read) on public.messages to authenticated;

-- Insert/select stay as the app needs them.
grant select, insert on public.messages to authenticated;
