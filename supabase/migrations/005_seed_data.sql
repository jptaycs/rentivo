-- ============================================================
-- Rentivo — Demo Seed Data
-- Demo hosts (cannot log in — empty password) and listings
-- mirroring the previous mock data set.
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- DEMO HOST USERS
-- Inserting into auth.users fires handle_new_user() which
-- creates the matching public.profiles row.
-- ───────────────────────────────────────────────────────────

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  id::uuid, 'authenticated', 'authenticated', email, '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name),
  '', '', '', '', '',
  now(), now()
from (values
  ('a0000000-0000-4000-8000-000000000001', 'host01@demo.rentivo.ph', 'Mark Reyes'),
  ('a0000000-0000-4000-8000-000000000002', 'host02@demo.rentivo.ph', 'Anna Cruz'),
  ('a0000000-0000-4000-8000-000000000003', 'host03@demo.rentivo.ph', 'Carlo Santos'),
  ('a0000000-0000-4000-8000-000000000004', 'host04@demo.rentivo.ph', 'Lea Villanueva'),
  ('a0000000-0000-4000-8000-000000000005', 'host05@demo.rentivo.ph', 'Ryan Lim'),
  ('a0000000-0000-4000-8000-000000000006', 'host06@demo.rentivo.ph', 'Grace Tan'),
  ('a0000000-0000-4000-8000-000000000007', 'host07@demo.rentivo.ph', 'James Ong'),
  ('a0000000-0000-4000-8000-000000000008', 'host08@demo.rentivo.ph', 'Sofia Mendoza'),
  ('a0000000-0000-4000-8000-000000000009', 'host09@demo.rentivo.ph', 'Ben Aguilar'),
  ('a0000000-0000-4000-8000-000000000010', 'host10@demo.rentivo.ph', 'Trisha Gomez'),
  ('a0000000-0000-4000-8000-000000000011', 'host11@demo.rentivo.ph', 'Nina Reyes'),
  ('a0000000-0000-4000-8000-000000000012', 'host12@demo.rentivo.ph', 'Andrei Flores'),
  ('a0000000-0000-4000-8000-000000000013', 'host13@demo.rentivo.ph', 'Maricel Santos'),
  ('a0000000-0000-4000-8000-000000000014', 'host14@demo.rentivo.ph', 'Diego Ramos'),
  ('a0000000-0000-4000-8000-000000000015', 'host15@demo.rentivo.ph', 'Camille Bautista'),
  ('a0000000-0000-4000-8000-000000000016', 'host16@demo.rentivo.ph', 'Marco Dela Cruz')
) as demo_hosts(id, email, full_name)
on conflict (id) do nothing;

-- Host attributes on the auto-created profiles
update public.profiles p
set is_host = true,
    is_verified = v.is_verified,
    host_rating = v.host_rating,
    host_review_count = v.host_review_count,
    response_time_hours = v.response_time_hours
from (values
  ('a0000000-0000-4000-8000-000000000001', true,  4.9, 89, 1),
  ('a0000000-0000-4000-8000-000000000002', true,  5.0, 42, 2),
  ('a0000000-0000-4000-8000-000000000003', true,  4.8, 31, 3),
  ('a0000000-0000-4000-8000-000000000004', false, 4.7, 28, 4),
  ('a0000000-0000-4000-8000-000000000005', true,  4.9, 15, 2),
  ('a0000000-0000-4000-8000-000000000006', true,  4.8, 17, 1),
  ('a0000000-0000-4000-8000-000000000007', true,  5.0, 36, 1),
  ('a0000000-0000-4000-8000-000000000008', true,  4.9, 48, 2),
  ('a0000000-0000-4000-8000-000000000009', true,  4.8, 22, 3),
  ('a0000000-0000-4000-8000-000000000010', true,  5.0, 61, 1),
  ('a0000000-0000-4000-8000-000000000011', true,  4.9, 38, 2),
  ('a0000000-0000-4000-8000-000000000012', false, 4.7, 14, 4),
  ('a0000000-0000-4000-8000-000000000013', true,  4.8,  9, 2),
  ('a0000000-0000-4000-8000-000000000014', true,  4.9, 19, 3),
  ('a0000000-0000-4000-8000-000000000015', true,  5.0, 27, 1),
  ('a0000000-0000-4000-8000-000000000016', true,  4.9, 13, 2)
) as v(id, is_verified, host_rating, host_review_count, response_time_hours)
where p.id = v.id::uuid;

-- ───────────────────────────────────────────────────────────
-- LISTINGS
-- rating/review_count set directly for demo purposes; real
-- listings get these from the review triggers.
-- ───────────────────────────────────────────────────────────

insert into public.listings (
  id, host_id, category, brand, model, title, description, condition,
  daily_price, weekly_price, monthly_price, security_deposit,
  city, province, is_instant_book, rating, review_count, images, accessories
) values
(
  'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  'mirrorless', 'Sony', 'A7 IV', 'Sony A7 IV Full-Frame Mirrorless Camera',
  'Perfect for professional photography and videography.', 'excellent',
  2500, 15000, 50000, 10000, 'Manila', 'Metro Manila', true, 4.98, 124,
  array['https://images.unsplash.com/photo-1621155346337-1d19476ba7d6?w=800&q=80','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800&q=80','https://images.unsplash.com/photo-1588681664899-f142ff2dc9b1?w=800&q=80'],
  array['Battery x2','Charger','Strap','Body Cap']
),
(
  'b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  'mirrorless', 'Canon', 'EOS R6 Mark II', 'Canon EOS R6 Mark II Mirrorless Camera',
  'Excellent for sports and wildlife photography.', 'mint',
  2200, 13000, 45000, 9000, 'Makati', 'Metro Manila', false, 4.95, 67,
  array['https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&q=80','https://images.unsplash.com/photo-1520390138845-fd2d229dd553?w=800&q=80'],
  array['Battery','Charger','USB-C Cable']
),
(
  'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
  'smartphone', 'Apple', 'iPhone 16 Pro Max', 'iPhone 16 Pro Max — 512GB',
  'Top-of-the-line iPhone with ProRAW, 4K120 video.', 'mint',
  1200, 7000, 24000, 5000, 'BGC', 'Metro Manila', true, 5.0, 38,
  array['https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=800&q=80','https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800&q=80'],
  array['Lightning Cable','Adapter','Case']
),
(
  'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004',
  'lens', 'Sony', 'FE 24-70mm f/2.8 GM II', 'Sony FE 24-70mm f/2.8 GM II Lens',
  'Professional standard zoom lens, tack-sharp across the frame.', 'excellent',
  1800, 10000, 35000, 8000, 'Quezon City', 'Metro Manila', true, 4.97, 55,
  array['https://images.unsplash.com/photo-1617005082133-548c4dd27f35?w=800&q=80'],
  array['Front Cap','Rear Cap','Hood','Pouch']
),
(
  'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005',
  'cinema', 'Sony', 'FX3', 'Sony FX3 Cinema Line Camera',
  'Full-frame cinema camera with S-Cinetone and 4K 120fps.', 'excellent',
  4500, 27000, 90000, 20000, 'Pasig', 'Metro Manila', false, 4.93, 19,
  array['https://images.unsplash.com/photo-1616161560417-66d4db5892ec?w=800&q=80'],
  array['Battery x2','XLR Adapter','USB-C Cable']
),
(
  'b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006',
  'smartphone', 'Samsung', 'Galaxy S25 Ultra', 'Samsung Galaxy S25 Ultra — 256GB',
  '200MP camera, S Pen, 8K video recording.', 'mint',
  1000, 6000, 20000, 4500, 'Cebu City', 'Cebu', true, 4.88, 22,
  array['https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=800&q=80'],
  array['USB-C Cable','S Pen','Case']
),
(
  'b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000007',
  'mirrorless', 'Nikon', 'Z8', 'Nikon Z8 Full-Frame Mirrorless Camera',
  '45.7MP stacked BSI sensor, 8K RAW video, no blackout shooting at 20fps.', 'mint',
  3200, 19000, 62000, 14000, 'Makati', 'Metro Manila', true, 4.97, 41,
  array['https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=800&q=80'],
  array['Battery x2','Charger','USB-C Cable','Strap']
),
(
  'b0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000008',
  'mirrorless', 'Fujifilm', 'X-T5', 'Fujifilm X-T5 Mirrorless Camera',
  '40MP APS-C sensor with iconic film simulation modes. Perfect for travel and street photography.', 'excellent',
  1800, 10500, 36000, 8000, 'Davao City', 'Davao del Sur', true, 4.96, 53,
  array['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&q=80'],
  array['Battery x2','Charger','SD Card 128GB','Strap']
),
(
  'b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000009',
  'mirrorless', 'Sony', 'A7C II', 'Sony A7C II Compact Full-Frame Camera',
  'Ultra-compact full-frame with AI autofocus. Great for travel vlogging and content creation.', 'excellent',
  2000, 12000, 40000, 9000, 'Quezon City', 'Metro Manila', true, 4.94, 29,
  array['https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800&q=80'],
  array['Battery x2','Charger','USB-C Cable','Strap']
),
(
  'b0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000010',
  'mirrorless', 'Canon', 'EOS R5', 'Canon EOS R5 Full-Frame Mirrorless',
  '45MP sensor, 8K RAW video, IBIS — the ultimate hybrid shooter camera.', 'excellent',
  3500, 21000, 70000, 16000, 'BGC', 'Metro Manila', false, 4.99, 76,
  array['https://images.unsplash.com/photo-1609902726285-00668009f004?w=800&q=80'],
  array['Battery x3','Charger','CF Express Card','Strap']
),
(
  'b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000011',
  'smartphone', 'Apple', 'iPhone 15 Pro', 'iPhone 15 Pro — 256GB Natural Titanium',
  'ProRAW, 4K ProRes video, 48MP main camera. Ideal for mobile filmmaking.', 'excellent',
  950, 5500, 19000, 4000, 'Manila', 'Metro Manila', true, 4.91, 47,
  array['https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&q=80'],
  array['USB-C Cable','MagSafe Charger','Case']
),
(
  'b0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000012',
  'smartphone', 'Google', 'Pixel 9 Pro', 'Google Pixel 9 Pro — 256GB',
  'Computational photography king — Night Sight, Magic Eraser, Best Take, and 50MP triple camera.', 'mint',
  900, 5200, 18000, 4000, 'Cebu City', 'Cebu', true, 4.89, 18,
  array['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=80'],
  array['USB-C Cable','Charger','Case']
),
(
  'b0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000013',
  'smartphone', 'Samsung', 'Galaxy Z Fold 6', 'Samsung Galaxy Z Fold 6 — 512GB',
  'Foldable powerhouse with 50MP triple camera. Unique for content monitoring and creative angles.', 'mint',
  1400, 8200, 28000, 6000, 'Pasig', 'Metro Manila', true, 4.85, 11,
  array['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=80'],
  array['USB-C Cable','S Pen','Case','Charger']
),
(
  'b0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000014',
  'mirrorless', 'OM System', 'OM-1 Mark II', 'OM System OM-1 Mark II Mirrorless',
  'IP53 weather-sealed, 120fps burst, AI subject detection. Built for outdoor and action photography.', 'excellent',
  1600, 9500, 32000, 7000, 'Davao City', 'Davao del Sur', false, 4.90, 23,
  array['https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800&q=80'],
  array['Battery x2','Charger','USB-C Cable','Strap']
),
(
  'b0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000015',
  'smartphone', 'Apple', 'iPhone 16 Pro', 'iPhone 16 Pro — 512GB Black Titanium',
  'Camera Control button, 5x optical zoom, 4K120 ProRes. The filmmaker''s iPhone.', 'mint',
  1100, 6500, 22000, 5000, 'Mandaluyong', 'Metro Manila', true, 4.97, 34,
  array['https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=800&q=80'],
  array['USB-C Cable','MagSafe Charger','Case','Screen Protector']
),
(
  'b0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000016',
  'cinema', 'Blackmagic', 'Pocket Cinema Camera 6K Pro', 'Blackmagic Pocket Cinema Camera 6K Pro',
  '6K Super 35 sensor, 13 stops of dynamic range, built-in ND filters. Cinema-grade for indie productions.', 'excellent',
  3800, 22000, 75000, 18000, 'Manila', 'Metro Manila', false, 4.92, 16,
  array['https://images.unsplash.com/photo-1616161560417-66d4db5892ec?w=800&q=80'],
  array['Battery x3','CFast Card','HDMI Cable','Battery Grip']
),

-- Creator bundles (category = 'bundle', kit contents in accessories)
(
  'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  'bundle', 'Sony', 'ZV-E10 Kit', 'Vlogging Kit',
  'Everything you need to start vlogging: camera, audio, support, and lighting.', 'excellent',
  1800, 10500, 36000, 8000, 'Manila', 'Metro Manila', true, 4.95, 21,
  array['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800&q=80'],
  array['Sony ZV-E10','Wireless Microphone','Tripod','LED Light']
),
(
  'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  'bundle', 'Sony', 'A7 IV Wedding Kit', 'Wedding Photography Kit',
  'Full wedding coverage kit with pro body, portrait glass, and lighting.', 'excellent',
  5500, 32000, 110000, 25000, 'Makati', 'Metro Manila', false, 4.98, 14,
  array['https://images.unsplash.com/photo-1606216794074-735e91aa2c92?w=800&q=80'],
  array['Sony A7 IV','85mm f/1.4 Lens','Flash x2','Extra Batteries']
),
(
  'c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
  'bundle', 'Fujifilm', 'X100VI Travel Kit', 'Travel Content Kit',
  'Compact travel kit for creators on the move.', 'excellent',
  2200, 13000, 44000, 10000, 'BGC', 'Metro Manila', true, 4.92, 9,
  array['https://images.unsplash.com/photo-1471341971476-ae15ff5dd4ea?w=800&q=80'],
  array['Fujifilm X100VI','ND Filter Set','Gorilla Pod','Memory Cards']
)
on conflict (id) do nothing;
