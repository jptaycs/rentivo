-- 031_qrph_payment_method.sql
-- Adds 'qrph' to the payment_method enum so create_booking can accept it.
-- QR Ph is a real PayMongo-processed payment method (unlike host_qr) —
-- money flows through Rentivo's merchant account exactly like GCash/Maya/
-- Card, it just uses a different PayMongo PaymentMethod type and returns
-- a QR image (next_action.code.image_url) instead of a redirect URL. Kept
-- in its own migration, alone, matching 027's precedent: no other
-- statement in this file references the new value, so there's no risk of
-- using it before this migration's own transaction commits.
alter type public.payment_method add value if not exists 'qrph';
