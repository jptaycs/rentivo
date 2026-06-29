-- ============================================================
-- Rentivo — Triggers & Functions
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- Auto-create profile on signup
-- ───────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ───────────────────────────────────────────────────────────
-- Update listing search vector
-- ───────────────────────────────────────────────────────────

create or replace function public.update_listing_search_vector()
returns trigger language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.brand, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.model, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.city, '')), 'C');
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_search_update
  before insert or update on public.listings
  for each row execute procedure public.update_listing_search_vector();

-- ───────────────────────────────────────────────────────────
-- Recalculate listing rating after each review
-- ───────────────────────────────────────────────────────────

create or replace function public.recalculate_listing_rating()
returns trigger language plpgsql as $$
declare
  target_listing_id uuid;
begin
  target_listing_id := coalesce(new.listing_id, old.listing_id);
  if target_listing_id is null then return new; end if;

  update public.listings
  set
    rating       = (select round(avg(rating)::numeric, 2) from public.reviews where listing_id = target_listing_id),
    review_count = (select count(*) from public.reviews where listing_id = target_listing_id),
    updated_at   = now()
  where id = target_listing_id;

  return new;
end;
$$;

create trigger after_review_upsert
  after insert or update or delete on public.reviews
  for each row execute procedure public.recalculate_listing_rating();

-- ───────────────────────────────────────────────────────────
-- Recalculate host rating after each review
-- ───────────────────────────────────────────────────────────

create or replace function public.recalculate_host_rating()
returns trigger language plpgsql as $$
declare
  target_host_id uuid;
begin
  target_host_id := coalesce(new.reviewee_id, old.reviewee_id);

  update public.profiles
  set
    host_rating        = (select round(avg(rating)::numeric, 2) from public.reviews where reviewee_id = target_host_id),
    host_review_count  = (select count(*) from public.reviews where reviewee_id = target_host_id),
    updated_at         = now()
  where id = target_host_id;

  return new;
end;
$$;

create trigger after_host_review
  after insert or update or delete on public.reviews
  for each row execute procedure public.recalculate_host_rating();

-- ───────────────────────────────────────────────────────────
-- Block availability dates when a booking is confirmed
-- ───────────────────────────────────────────────────────────

create or replace function public.block_availability_on_confirm()
returns trigger language plpgsql as $$
declare
  d date;
begin
  -- Only act when status moves to confirmed or active
  if new.status not in ('confirmed', 'active') then return new; end if;
  if old.status = new.status then return new; end if;

  d := new.pickup_date;
  while d < new.return_date loop
    insert into public.availability_blocks (listing_id, blocked_on, reason)
    values (new.listing_id, d, 'booked')
    on conflict (listing_id, blocked_on) do nothing;
    d := d + 1;
  end loop;

  return new;
end;
$$;

create trigger booking_confirmed_block
  after update on public.bookings
  for each row execute procedure public.block_availability_on_confirm();

-- ───────────────────────────────────────────────────────────
-- Unblock availability when booking is cancelled
-- ───────────────────────────────────────────────────────────

create or replace function public.unblock_availability_on_cancel()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status != 'cancelled' then
    delete from public.availability_blocks
    where listing_id = new.listing_id
      and blocked_on between new.pickup_date and new.return_date - 1
      and reason = 'booked';
  end if;
  return new;
end;
$$;

create trigger booking_cancelled_unblock
  after update on public.bookings
  for each row execute procedure public.unblock_availability_on_cancel();

-- ───────────────────────────────────────────────────────────
-- updated_at auto-refresh for bookings
-- ───────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute procedure public.touch_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

-- ───────────────────────────────────────────────────────────
-- Listing availability check (callable from client)
-- Returns true if listing is available for the date range
-- ───────────────────────────────────────────────────────────

create or replace function public.is_listing_available(
  p_listing_id  uuid,
  p_from        date,
  p_to          date
)
returns boolean language sql stable as $$
  select not exists (
    select 1 from public.availability_blocks
    where listing_id = p_listing_id
      and blocked_on between p_from and p_to - 1
  );
$$;

-- ───────────────────────────────────────────────────────────
-- Search listings (full-text + filters)
-- ───────────────────────────────────────────────────────────

create or replace function public.search_listings(
  p_query       text        default null,
  p_category    equipment_category default null,
  p_city        text        default null,
  p_brand       text        default null,
  p_min_price   integer     default null,
  p_max_price   integer     default null,
  p_instant_book boolean    default null,
  p_verified    boolean     default null,
  p_min_rating  numeric     default null,
  p_from        date        default null,
  p_to          date        default null,
  p_limit       integer     default 24,
  p_offset      integer     default 0
)
returns table (
  id uuid, host_id uuid, category equipment_category, brand text, model text,
  title text, description text, condition listing_condition,
  daily_price integer, weekly_price integer, monthly_price integer,
  security_deposit integer, city text, province text,
  is_instant_book boolean, rating numeric, review_count integer,
  images text[], accessories text[], created_at timestamptz,
  host_full_name text, host_avatar_url text, host_is_verified boolean,
  rank real
)
language sql stable as $$
  select
    l.id, l.host_id, l.category, l.brand, l.model,
    l.title, l.description, l.condition,
    l.daily_price, l.weekly_price, l.monthly_price,
    l.security_deposit, l.city, l.province,
    l.is_instant_book, l.rating, l.review_count,
    l.images, l.accessories, l.created_at,
    p.full_name, p.avatar_url, p.is_verified,
    case
      when p_query is not null
      then ts_rank(l.search_vector, plainto_tsquery('english', p_query))
      else 1.0
    end as rank
  from public.listings l
  join public.profiles p on p.id = l.host_id
  where l.is_active = true
    and l.is_draft = false
    and (p_category  is null or l.category     = p_category)
    and (p_city      is null or l.city         ilike '%' || p_city || '%')
    and (p_brand     is null or l.brand        ilike p_brand)
    and (p_min_price is null or l.daily_price  >= p_min_price)
    and (p_max_price is null or l.daily_price  <= p_max_price)
    and (p_instant_book is null or l.is_instant_book = p_instant_book)
    and (p_verified  is null or p.is_verified   = p_verified)
    and (p_min_rating is null or l.rating      >= p_min_rating)
    and (p_query     is null or l.search_vector @@ plainto_tsquery('english', p_query))
    and (
      p_from is null or p_to is null or
      public.is_listing_available(l.id, p_from, p_to)
    )
  order by rank desc, l.rating desc nulls last, l.review_count desc
  limit p_limit offset p_offset;
$$;
