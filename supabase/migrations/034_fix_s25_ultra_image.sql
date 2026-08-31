-- ============================================================
-- Fix a mismatched listing image missed by 023: the Samsung
-- Galaxy S25 Ultra listing's image showed a box branded "Samsung
-- Galaxy S23 Ultra" — same class of bug 023 fixed everywhere
-- else, apparently missed for this one row (023 itself replaced
-- this listing's image, but with the wrong device generation).
-- Replaced with a verified S25 Ultra photo — visually confirmed
-- before use (front + back view, One UI home screen, quad-camera
-- Ultra design) from an Unsplash set tagged specifically
-- "samsung-galaxy-s25-ultra", to avoid repeating 023's original
-- mistake of swapping in an unverified photo.
-- ============================================================

update public.listings set images = array['https://images.unsplash.com/photo-1738830234395-a351829a1c7b?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000006'; -- Samsung Galaxy S25 Ultra
