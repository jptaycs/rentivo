-- Rentivo — Register the two Realtime-subscribed tables in supabase_realtime.
--
-- ── The bug this fixes ──
-- `supabase_realtime` existed with `puballtables = false` and ZERO tables in it
-- (verified: `select ... from pg_publication_tables where pubname =
-- 'supabase_realtime'` returned no rows). Postgres only streams changes for
-- tables in a publication, so `postgres_changes` delivered NOTHING for any table
-- in this project.
--
-- It failed SILENTLY, which is why it went unnoticed for so long: the client
-- receives `SUBSCRIBED`, no error is raised anywhere, and events simply never
-- arrive. Proven on 2026-09-03 by subscribing with a real signed-in session and
-- inserting a real message — channel SUBSCRIBED, insert returned 201, zero
-- events in 6s.
--
-- Symptoms it caused, all of which read as "the app is just slow to update":
--   * a message from the other party never appeared until the recipient reloaded
--   * the navbar notification bell never updated until a page load
--   * the thread list never re-ordered or bumped unread counts live
-- None of it was data loss — every row was always written correctly and was
-- there on refresh. Only the live push was dead.
--
-- ── Why only these two tables ──
-- These are the ONLY tables the app subscribes to, and every subscription is
-- INSERT-only:
--   * public.messages       — useConversation.ts (filtered by conversation_id)
--                             and useThreads.ts (all inserts, to reload threads)
--   * public.notifications  — useNotifications.ts (filtered by user_id)
-- `conversations` is deliberately NOT added: no hook subscribes to it, and a
-- publication entry with no listener is just extra WAL traffic broadcasting row
-- data nobody reads. Add it in its own migration if a subscription ever appears.
--
-- ── Why this is safe to expose ──
-- Realtime applies RLS to `postgres_changes`, so a subscriber only ever receives
-- rows its policies already permit it to SELECT. Both tables have RLS enabled
-- with participant/owner-scoped read policies (003, 012, 053), so this grants no
-- read access that a plain query did not already allow.
--
-- Replica identity is deliberately left at the default (primary key) on both.
-- `replica identity full` is only needed to evaluate RLS against OLD rows for
-- UPDATE/DELETE events; every subscription here is INSERT-only, and switching to
-- `full` would put the entire previous row image into the WAL for no benefit.
--
-- Idempotent: `alter publication ... add table` errors if the table is already a
-- member, so each add is guarded. Safe to re-run and safe to replay
-- statement-by-statement in the SQL editor.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
