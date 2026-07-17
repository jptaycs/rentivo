-- ============================================================
-- Rentivo — Let booking participants mark messages as read
-- ============================================================

create policy "messages: participants update"
  on public.messages for update
  using (
    exists (
      select 1 from public.bookings
      where id = booking_id
        and (renter_id = auth.uid() or host_id = auth.uid())
    )
  );

grant update (is_read) on public.messages to authenticated;
