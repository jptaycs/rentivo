-- ============================================================
-- Rentivo — Demo Renter Account
-- Second pre-confirmed account so the booking loop can be
-- exercised end-to-end (no_self_booking blocks single-account tests).
-- Credentials: renter@demo.rentivo.ph / DemoRentivo1
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-0000000000fe',
  'authenticated', 'authenticated',
  'renter@demo.rentivo.ph',
  extensions.crypt('DemoRentivo1', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Demo Renter"}'::jsonb,
  '', '', '', '', '',
  now(), now()
)
on conflict (id) do nothing;
