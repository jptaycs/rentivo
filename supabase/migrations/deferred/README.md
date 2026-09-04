# Deferred migrations

Migrations parked here are **written but deliberately not applied yet**, because
applying them would break the currently deployed production site.

They live in a subdirectory because `supabase db push` applies EVERY pending
migration in `supabase/migrations/`, not just the newest one. Leaving a
not-yet-safe migration at the top level means the next unrelated `db push`
sweeps it in — which is exactly what happened on 2026-09-05 with 066, briefly
setting `listings.latitude/longitude` NOT NULL on production before it was
caught and reverted.

To apply one: move it back to `supabase/migrations/`, then `supabase db push
--linked --yes`, then confirm with `supabase migration list --linked`.

## Currently parked

- `066_listing_coordinates_required.sql` — makes listing coordinates NOT NULL.
  Safe to apply only AFTER the host wizard that sends coordinates is deployed to
  production. Until then the live wizard would fail every listing creation.
