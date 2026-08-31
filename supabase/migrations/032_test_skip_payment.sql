-- 032_test_skip_payment.sql
-- Adds 'test_skip' to the payment_method enum: a checkout option that
-- creates a booking as immediately paid with zero real charge, site-wide
-- (dev and production), while Rentivo is in its pre-launch testing phase.
-- Deliberately explicit and its own value (not reusing an existing method)
-- so every test_skip booking is honestly labeled as such in the data,
-- distinguishable from a real payment at a glance.
-- Own migration file, alone, matching 027/031's precedent — no other
-- statement in this file references the new value.
alter type public.payment_method add value if not exists 'test_skip';
