-- ============================================================
-- 041_verification_auto_check.sql
-- A real host's verification was submitted with two Canon G7X product
-- photographs standing in for an ID and a selfie, and both were accepted:
-- the uploads only ever validated file type and size. The browser now runs
-- an on-device face check (src/lib/id-validation.ts) before submission.
--
-- These two columns record that a submission bypassed that check — either
-- via the explicit "my document is valid" override, or because the detector
-- itself could not run — so /admin/verifications can flag it for a harder
-- look.
--
-- IMPORTANT: this flag is CLIENT-SUPPLIED and therefore advisory only. The
-- check runs in the browser, so anyone crafting a raw PostgREST request can
-- bypass both the check and this flag. It is a triage signal for the
-- reviewer, never a security control — the human /admin review remains the
-- actual gate on `profiles.is_verified`.
--
-- No new table, so the project's "enable RLS in the creation migration" rule
-- is not triggered. 015 grants select+insert at table level, so both columns
-- are insertable with no grant change, and there is no update grant, so a
-- submission's flag cannot be edited after the fact.
-- ============================================================

alter table public.verification_requests
  add column if not exists auto_check_failed boolean not null default false,
  add column if not exists auto_check_detail text;

comment on column public.verification_requests.auto_check_failed is
  'Client-reported: the on-device ID/selfie face check did not pass, or could not run. Advisory only — not a security control.';
