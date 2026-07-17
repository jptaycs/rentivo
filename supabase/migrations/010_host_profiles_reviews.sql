-- ============================================================
-- Rentivo — Host profile fields + demo review seeds
-- ============================================================

-- Public host profile info, editable by the owner
alter table public.profiles
  add column bio  text,
  add column city text;

grant update (full_name, avatar_url, is_host, bio, city) on public.profiles to authenticated;

-- ───────────────────────────────────────────────────────────
-- Seed: three completed + paid bookings by the demo renter,
-- each with a renter→host review (listing-linked) and a
-- host→renter review. The existing after_review_upsert trigger
-- recalculates listing + host rating aggregates.
-- ───────────────────────────────────────────────────────────

do $$
declare
  v_renter uuid := 'a0000000-0000-4000-8000-0000000000fe';
  r record;
  i integer := 0;
  v_booking uuid;
  renter_comments constant text[] := array[
    'Super smooth transaction. Gear was in perfect condition and the host even threw in extra batteries. Will rent again!',
    'Very responsive host with clear pickup instructions. So happy I could afford to shoot on gear like this.',
    'Professional, punctual, and everything came in a hard case exactly as listed. 10/10 experience.'
  ];
  host_comments constant text[] := array[
    'Great renter — took excellent care of the equipment and returned it right on time.',
    'Smooth handoff both ways, easy to coordinate with. Welcome back anytime!',
    'Communicative and careful with the gear. Highly recommended renter.'
  ];
begin
  for r in
    select l.id, l.host_id, l.daily_price, l.security_deposit
    from public.listings l
    where l.is_active and not l.is_draft
      and l.category <> 'bundle'
      and l.host_id <> v_renter
    order by l.created_at
    limit 3
  loop
    i := i + 1;

    insert into public.bookings (
      listing_id, renter_id, host_id, pickup_date, return_date,
      rental_fee, security_deposit, service_fee, protection_fee, total_amount,
      status, payment_status, payment_method, paymongo_ref, paid_at
    ) values (
      r.id, v_renter, r.host_id,
      current_date - (14 + i * 7), current_date - (12 + i * 7),
      r.daily_price * 2, r.security_deposit,
      round(r.daily_price * 2 * 0.12)::integer, round(r.daily_price * 2 * 0.05)::integer,
      r.daily_price * 2 + round(r.daily_price * 2 * 0.12)::integer
        + round(r.daily_price * 2 * 0.05)::integer + r.security_deposit,
      'completed', 'paid', 'gcash', 'pi_seed_demo', now() - ((14 + i * 7) || ' days')::interval
    )
    returning id into v_booking;

    insert into public.reviews (booking_id, reviewer_id, reviewee_id, listing_id, rating, comment, created_at)
    values (v_booking, v_renter, r.host_id, r.id, 5, renter_comments[i],
            now() - ((11 + i * 7) || ' days')::interval);

    insert into public.reviews (booking_id, reviewer_id, reviewee_id, rating, comment, created_at)
    values (v_booking, r.host_id, v_renter, 5, host_comments[i],
            now() - ((11 + i * 7) || ' days')::interval);
  end loop;
end $$;
