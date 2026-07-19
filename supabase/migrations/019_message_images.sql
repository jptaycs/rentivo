-- 019_message_images.sql
-- Public bucket for chat image attachments. URLs are unguessable
-- (<uid>/<uuid>.<ext>) and only surface inside RLS-protected conversations.
-- No new tables → no table-grant/RLS concerns (see 016/017 note in AGENTS.md).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('message-images', 'message-images', true, 10485760, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

create policy "message-images: public read"
  on storage.objects for select
  using (bucket_id = 'message-images');

create policy "message-images: own folder write"
  on storage.objects for insert
  with check (bucket_id = 'message-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "message-images: own folder delete"
  on storage.objects for delete
  using (bucket_id = 'message-images' and auth.uid()::text = (storage.foldername(name))[1]);
