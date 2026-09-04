-- 066: coordinates are required. Run scripts/backfill-listing-coordinates.mjs
-- FIRST -- this fails while any row is null.
--
-- NOT APPLIED as part of this task (2026-09-05). The currently deployed
-- production wizard does not send coordinates yet, so applying this NOT NULL
-- constraint now would make listing creation fail for every host on the live
-- site. Apply this only after the app changes (later tasks in this plan)
-- that send latitude/longitude from the wizard have been deployed to
-- production.
alter table public.listings
  alter column latitude  set not null,
  alter column longitude set not null;
