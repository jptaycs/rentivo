-- 062: notification type for a newly issued commission bill. Own file:
-- Postgres forbids using a new enum value in the transaction that adds it
-- (precedent: 027, 036, 042). Nothing else in this file.
alter type public.notification_type add value if not exists 'bill_issued';
