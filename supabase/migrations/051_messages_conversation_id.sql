-- Rentivo — Point messages at conversations.
--
-- booking_id is deliberately LEFT IN PLACE and still populated. Dropping it is
-- the one irreversible step in this workstream and is deferred to its own
-- optional migration (057, not yet applied — see AGENTS.md's To Do), so
-- everything up to here can be rolled back.

-- Ruling 1 (pre-flight): make booking_id nullable HERE, unconditionally.
-- create_inquiry (055) inserts messages with booking_id = null, so the column
-- must already be nullable by then. The original plan deferred this to a
-- "check and add it if needed" step in Task 5, which an implementer can skip,
-- producing a confusing not-null violation two migrations later.
alter table public.messages alter column booking_id drop not null;

alter table public.messages
  add column conversation_id uuid references public.conversations(id) on delete cascade;

update public.messages m
   set conversation_id = c.id
  from public.conversations c
 where c.booking_id = m.booking_id
   and m.conversation_id is null;

-- Fail loudly rather than silently leaving orphans: 050 created a conversation
-- for every booking, so any null here means the backfill was incomplete.
do $$
declare v_orphans integer;
begin
  select count(*) into v_orphans from public.messages where conversation_id is null;
  if v_orphans > 0 then
    raise exception 'refusing to continue: % message(s) have no conversation', v_orphans;
  end if;
end $$;

alter table public.messages alter column conversation_id set not null;

create index messages_conversation_idx on public.messages(conversation_id);

-- ⚠️ Ruling 2 (pre-flight) — BACKWARD-COMPATIBILITY SHIM. Do not omit.
--
-- These migrations apply to the HOSTED database that rentivo.live serves right
-- now, but the app code that knows about conversation_id does not ship until
-- Tasks 6-9 are built and deployed. The instant conversation_id becomes NOT
-- NULL above, the CURRENTLY DEPLOYED useConversation.send() — which inserts
-- only booking_id — starts failing with a not-null violation, and after 052 its
-- insert also fails the new RLS check. That is a live messaging outage on a
-- production site for the whole span of Tasks 3-9.
--
-- This trigger fills conversation_id from booking_id for any client that still
-- sends the old shape. Postgres evaluates RLS WITH CHECK *after* BEFORE ROW
-- triggers, so the filled-in row satisfies both the constraint and the policy.
--
-- Task 11 removes this trigger together with the booking_id column.
create or replace function public.fill_conversation_from_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.conversation_id is null and new.booking_id is not null then
    select c.id into new.conversation_id
      from public.conversations c
     where c.booking_id = new.booking_id;
  end if;
  return new;
end;
$$;

create trigger messages_fill_conversation
  before insert on public.messages
  for each row execute function public.fill_conversation_from_booking();

-- Keep thread ordering server-side so a client cannot forge it.
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();
