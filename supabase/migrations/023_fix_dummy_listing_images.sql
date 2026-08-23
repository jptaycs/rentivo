-- ============================================================
-- Fix mismatched listing images seeded in 005: most of the
-- Unsplash placeholder photos didn't actually depict the gear
-- they were attached to (a Sony A7 IV listing's photos were
-- tulips, a smartphone showing a news app, and Canon-branded
-- lenses on a Sony body; the Sony FX3 and the Blackmagic Pocket
-- Cinema Camera 6K Pro shared one image of a person wearing a
-- VR headset; the Google Pixel 9 Pro and Samsung Galaxy Z Fold 6
-- shared one image of an unrelated iPhone; other listings showed
-- a beach, headphones, a portrait, a Polaroid camera, and a
-- drone — out of this marketplace's scope entirely). Replaced
-- each with a verified photo of the actual product (or, where an
-- exact model shot wasn't available on Unsplash, an accurate
-- same-brand/same-category shot) after visually checking every
-- candidate. Listings 4, 14, 15 and bundles c1/c2 already had
-- reasonably accurate images and are left unchanged.
-- ============================================================

update public.listings set images = array['https://images.unsplash.com/photo-1692030180082-c468ed11a108?w=800&q=80','https://images.unsplash.com/photo-1697311622332-184b7bb19a46?w=800&q=80','https://images.unsplash.com/photo-1581591546349-f29007542ed4?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000001'; -- Sony A7 IV

update public.listings set images = array['https://images.unsplash.com/photo-1613483187285-e84c582608f9?w=800&q=80','https://images.unsplash.com/photo-1613483187433-8c40c50ed660?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000002'; -- Canon EOS R6 Mark II

update public.listings set images = array['https://images.unsplash.com/photo-1695619575474-9b45e37bc1e6?w=800&q=80','https://images.unsplash.com/photo-1695822958645-b2b058159215?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000003'; -- iPhone 16 Pro Max

update public.listings set images = array['https://images.unsplash.com/photo-1743815888957-5be0bc9da851?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000005'; -- Sony FX3

update public.listings set images = array['https://images.unsplash.com/photo-1678911820864-e2c567c655d7?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000006'; -- Samsung Galaxy S25 Ultra

update public.listings set images = array['https://images.unsplash.com/photo-1614108830714-74f0e4c8cd7e?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000007'; -- Nikon Z8

update public.listings set images = array['https://images.unsplash.com/photo-1749016888524-967635aa2c6f?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000008'; -- Fujifilm X-T5

update public.listings set images = array['https://images.unsplash.com/photo-1552233706-c3ff6a3da279?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000009'; -- Sony A7C II

update public.listings set images = array['https://images.unsplash.com/photo-1641770058653-6ba80f9b7ebc?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000010'; -- Canon EOS R5

update public.listings set images = array['https://images.unsplash.com/photo-1718223483120-8131e57f948b?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000011'; -- iPhone 15 Pro

update public.listings set images = array['https://images.unsplash.com/photo-1756517313520-c6c25364ce65?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000012'; -- Google Pixel 9 Pro

update public.listings set images = array['https://images.unsplash.com/photo-1784969314879-4d9a260e98e6?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000013'; -- Samsung Galaxy Z Fold 6

update public.listings set images = array['https://images.unsplash.com/photo-1543235074-4768b5c2233c?w=800&q=80']
  where id = 'b0000000-0000-4000-8000-000000000016'; -- Blackmagic Pocket Cinema Camera 6K Pro

update public.listings set images = array['https://images.unsplash.com/photo-1692895591954-451050db22fd?w=800&q=80']
  where id = 'c0000000-0000-4000-8000-000000000003'; -- Travel Content Kit bundle
