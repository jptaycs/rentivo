-- ============================================================
-- Rentivo — Initial Schema
-- Run this in Supabase SQL Editor or via supabase db push
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- for full-text search on listings

-- ───────────────────────────────────────────────────────────
-- ENUMS
-- ───────────────────────────────────────────────────────────

create type equipment_category as enum (
  'mirrorless', 'dslr', 'cinema', 'smartphone', 'lens', 'bundle'
);

create type listing_condition as enum (
  'mint', 'excellent', 'good', 'fair'
);

create type booking_status as enum (
  'pending', 'confirmed', 'active', 'completed', 'cancelled'
);

create type payment_method as enum (
  'gcash', 'maya', 'card', 'apple_pay', 'google_pay'
);

create type payment_status as enum (
  'unpaid', 'paid', 'refunded'
);

-- ───────────────────────────────────────────────────────────
-- PROFILES
-- Extends auth.users — created automatically via trigger
-- ───────────────────────────────────────────────────────────

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null default '',
  avatar_url          text,
  is_verified         boolean not null default false,
  is_host             boolean not null default false,
  host_rating         numeric(3,2),
  host_review_count   integer not null default 0,
  response_time_hours integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────
-- LISTINGS
-- ───────────────────────────────────────────────────────────

create table public.listings (
  id               uuid primary key default uuid_generate_v4(),
  host_id          uuid not null references public.profiles(id) on delete cascade,
  category         equipment_category not null,
  brand            text not null,
  model            text not null,
  title            text not null,
  description      text not null default '',
  condition        listing_condition not null default 'excellent',
  serial_number    text,

  -- Pricing (in PHP, integer to avoid float rounding)
  daily_price      integer not null check (daily_price > 0),
  weekly_price     integer check (weekly_price > 0),
  monthly_price    integer check (monthly_price > 0),
  security_deposit integer not null default 0 check (security_deposit >= 0),

  -- Location
  city             text not null,
  province         text not null,
  street_address   text,
  latitude         numeric(10,7),
  longitude        numeric(10,7),

  -- Features
  is_instant_book  boolean not null default false,
  is_active        boolean not null default true,
  is_draft         boolean not null default false,

  -- Computed (updated by trigger after reviews)
  rating           numeric(3,2),
  review_count     integer not null default 0,

  -- Arrays
  images           text[] not null default '{}',
  accessories      text[] not null default '{}',

  -- Search vector (auto-updated by trigger)
  search_vector    tsvector,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Full-text search index
create index listings_search_idx on public.listings using gin(search_vector);
create index listings_category_idx on public.listings(category);
create index listings_host_idx on public.listings(host_id);
create index listings_active_idx on public.listings(is_active) where is_active = true;
create index listings_city_idx on public.listings(city);

-- ───────────────────────────────────────────────────────────
-- AVAILABILITY BLOCKS
-- Dates the host has marked as unavailable
-- ───────────────────────────────────────────────────────────

create table public.availability_blocks (
  id          uuid primary key default uuid_generate_v4(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  blocked_on  date not null,
  reason      text, -- 'booked' | 'personal' | null
  created_at  timestamptz not null default now(),

  unique (listing_id, blocked_on)
);

create index availability_listing_idx on public.availability_blocks(listing_id);

-- ───────────────────────────────────────────────────────────
-- BOOKINGS
-- ───────────────────────────────────────────────────────────

create table public.bookings (
  id               uuid primary key default uuid_generate_v4(),
  listing_id       uuid not null references public.listings(id),
  renter_id        uuid not null references public.profiles(id),
  host_id          uuid not null references public.profiles(id),

  pickup_date      date not null,
  return_date      date not null,
  total_days       integer not null generated always as (return_date - pickup_date) stored,

  -- Amounts in PHP
  rental_fee       integer not null,
  security_deposit integer not null,
  service_fee      integer not null,
  protection_fee   integer not null,
  total_amount     integer not null,

  status           booking_status not null default 'pending',

  is_delivery      boolean not null default false,
  delivery_address text,

  payment_method   payment_method,
  payment_status   payment_status not null default 'unpaid',
  paymongo_ref     text,        -- PayMongo payment intent ID
  booking_ref      text unique not null default 'RNT-' || upper(substring(uuid_generate_v4()::text, 1, 6)),

  host_notes       text,
  renter_notes     text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint valid_dates check (return_date > pickup_date),
  constraint no_self_booking check (renter_id != host_id)
);

create index bookings_listing_idx on public.bookings(listing_id);
create index bookings_renter_idx  on public.bookings(renter_id);
create index bookings_host_idx    on public.bookings(host_id);
create index bookings_status_idx  on public.bookings(status);

-- ───────────────────────────────────────────────────────────
-- MESSAGES
-- ───────────────────────────────────────────────────────────

create table public.messages (
  id          uuid primary key default uuid_generate_v4(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id),
  content     text not null,
  image_url   text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index messages_booking_idx on public.messages(booking_id);
create index messages_sender_idx  on public.messages(sender_id);

-- ───────────────────────────────────────────────────────────
-- REVIEWS
-- ───────────────────────────────────────────────────────────

create table public.reviews (
  id           uuid primary key default uuid_generate_v4(),
  booking_id   uuid not null references public.bookings(id),
  reviewer_id  uuid not null references public.profiles(id),
  reviewee_id  uuid not null references public.profiles(id),
  listing_id   uuid references public.listings(id),
  rating       integer not null check (rating between 1 and 5),
  comment      text not null,
  created_at   timestamptz not null default now(),

  -- One review per user per booking
  unique (booking_id, reviewer_id)
);

create index reviews_listing_idx   on public.reviews(listing_id);
create index reviews_reviewee_idx  on public.reviews(reviewee_id);

-- ───────────────────────────────────────────────────────────
-- WISHLIST
-- ───────────────────────────────────────────────────────────

create table public.wishlist (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  created_at  timestamptz not null default now(),

  unique (user_id, listing_id)
);

create index wishlist_user_idx on public.wishlist(user_id);

-- ───────────────────────────────────────────────────────────
-- PROMO CODES
-- ───────────────────────────────────────────────────────────

create table public.promo_codes (
  id              uuid primary key default uuid_generate_v4(),
  code            text unique not null,
  discount_pct    integer check (discount_pct between 1 and 100),
  discount_flat   integer,      -- fixed PHP amount
  max_uses        integer,
  used_count      integer not null default 0,
  valid_from      timestamptz,
  valid_until     timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
