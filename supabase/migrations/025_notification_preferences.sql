-- ============================================================
-- Rentivo — Persist notification preferences
--
-- Settings' notification toggles were local-only state, resetting on
-- every reload. Defaults here match the UI's existing hardcoded
-- defaults exactly. These are preference flags only — nothing reads
-- them yet to gate actual sends.
-- ============================================================

alter table public.profiles
  add column notify_new_booking boolean not null default true,
  add column notify_messages    boolean not null default true,
  add column notify_reminders   boolean not null default true,
  add column notify_promos      boolean not null default false;

grant update (notify_new_booking, notify_messages, notify_reminders, notify_promos)
  on public.profiles to authenticated;
