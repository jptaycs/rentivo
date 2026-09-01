-- 036_add_digital_camera_category.sql
-- Compact / point-and-shoot cameras had no category that fit — a host
-- listing a Canon G7X Mark III had to shoehorn it into another one.
-- Isolated in its own migration: Postgres does not permit *using* a newly
-- added enum value in the same transaction that adds it (same reason 027
-- isolated 'host_qr').
alter type equipment_category add value if not exists 'digital';
