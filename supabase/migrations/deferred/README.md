# Deferred migrations

Migrations parked here are **written but deliberately not applied yet**, because
applying them would break the currently deployed production site.

They live in a subdirectory because `supabase db push` applies EVERY pending
migration in `supabase/migrations/`, not just the newest one. Leaving a
not-yet-safe migration at the top level means the next unrelated `db push`
sweeps it in — which is exactly what happened on 2026-09-05 with 066, briefly
setting `listings.latitude/longitude` NOT NULL on production before it was
caught and reverted.

To apply one: first run `node --experimental-strip-types
scripts/backfill-listing-coordinates.mjs` against production — mandatory, not
optional. Any listing created before this feature deployed still has null
`latitude`/`longitude` (that script is the only thing that fills them in),
and 066 makes those columns `NOT NULL`; skipping the backfill makes the
migration itself fail on the first null row it finds. The script itself
aborts loudly (and applies nothing) if any row is still null when it's done,
so re-run it and confirm zero rows left before proceeding. Then move the
migration back to `supabase/migrations/`, run `supabase db push --linked
--yes`, and confirm with `supabase migration list --linked`.

## Currently parked

- `066_listing_coordinates_required.sql` — makes listing coordinates NOT NULL.
  Safe to apply only AFTER the host wizard that sends coordinates is deployed to
  production. Until then the live wizard would fail every listing creation.
