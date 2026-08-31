-- 027_host_qr_payment_type.sql
-- Split into its own migration, applied and committed on its own, because
-- no prior migration in this repo has ever used `alter type ... add value`
-- and there's no in-repo precedent for whether Postgres allows referencing
-- a brand-new enum value later in the *same* transaction (even from inside
-- a not-yet-executed function body). Keeping this migration to nothing but
-- the enum addition sidesteps the question entirely — every later use of
-- 'host_qr' (028 onward) runs in a transaction that starts after this one
-- has already committed.
alter type public.payment_method add value if not exists 'host_qr';
