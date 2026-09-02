-- 042_verification_notification_types.sql
-- Hosts were never told in-app when an admin approved or declined their ID.
-- The outcome *email* already goes out (notifyVerificationReviewed, fired from
-- POST /api/admin/verifications/[id]/review), but nothing wrote a notifications
-- row, so the navbar bell and /dashboard/notifications stayed silent — the one
-- moment a host most needs to know, since approval is what puts their listings
-- on the marketplace (037).
--
-- Isolated in its own migration: Postgres does not permit *using* a newly added
-- enum value in the same transaction that adds it. 043 is where these get used.
-- Same reason 027 isolated 'host_qr' and 036 isolated 'digital'.
alter type notification_type add value if not exists 'verification_approved';
alter type notification_type add value if not exists 'verification_rejected';
