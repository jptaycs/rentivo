# Message Image Attachments — Design

**Date:** 2026-07-19
**Status:** Approved

## Goal

Let booking participants send photos in chat (gear condition, meetup spots, damage evidence). The `messages.image_url` column has existed since migration 001 but has no upload UI. This wires it end-to-end.

## Decisions (made with user)

- **Privacy model:** public `message-images` bucket with unguessable UUID paths. URLs only surface inside the RLS-protected conversation. Signed-URL complexity rejected as YAGNI at this scale.
- **Composer UX:** attach → thumbnail preview above input → optional caption → send. One message may carry image + text together. Cancel (✕) available before sending.
- **Upload path:** client uploads directly to Supabase Storage (matches existing avatar/listing-photo pattern), then inserts the message row. No new API routes, no service-role involvement.
- **One image per message** — dictated by the single `image_url` column; not adding a gallery.

## Components

### Migration `019_message_images.sql`

- Insert bucket `message-images`: `public = true`, `file_size_limit = 10485760`, `allowed_mime_types = {image/jpeg, image/png, image/webp, image/avif}` — `on conflict (id) do nothing`, same shape as 004.
- Policies on `storage.objects` (copy the `listing-images` block):
  - public read (`select` where `bucket_id = 'message-images'`)
  - own-folder insert (`auth.uid()::text = (storage.foldername(name))[1]`)
  - own-folder delete (same predicate)
- No new tables → the project's broad-grant/RLS footgun (016/017) does not apply; `storage.objects` already has RLS.

### `useConversation.ts` — `send()`

Signature becomes `send(content: string, imageFile?: File): Promise<string | null>`.

- If `imageFile`: upload to `message-images/<userId>/<crypto.randomUUID()>.<ext>` (ext from the file's MIME type), then `getPublicUrl`, then insert `{ booking_id, sender_id, content: content.trim(), image_url }`.
- `content` may be `''` for image-only messages (column is `not null`, empty string is fine).
- Upload failure → return the error message, do **not** insert a message row.
- Text-only path unchanged. Existing guard `!content.trim()` becomes `!content.trim() && !imageFile`.

### `ConversationView.tsx`

- `ImagePlus` icon button (lucide) inside the composer row, wired to a hidden `<input type="file" accept="image/jpeg,image/png,image/webp,image/avif">`.
- Picked file → local `URL.createObjectURL` thumbnail chip above the composer with an ✕ to clear (revoke the object URL on clear/send).
- Send enabled when `input.trim() || pendingImage`. On failure, restore both text and pending image so nothing is lost.
- Bubble rendering: if `msg.image_url`, render a rounded image (`max-h-64`, `object-cover`, lazy) above the caption text; click opens the full-size image in a new tab. Empty-string captions render nothing below the image.

### `useThreads.ts`

- Last-message preview: if `content` is empty but `image_url` is set, show `📷 Photo`. Requires adding `image_url` to the thread query's select list.

## Data flow

pick file → preview chip (local object URL) → send → Storage upload (`<uid>/<uuid>.<ext>`) → public URL → `messages` insert (RLS: sender must be booking participant) → Realtime INSERT fans out to the other participant with `image_url` included → bubble renders on both sides.

## Error handling

- Storage rejects wrong mime/oversize/foreign-folder writes (bucket limits + policies) → surfaced via the existing composer error line.
- Insert failure after successful upload leaves an orphaned storage object — accepted (harmless, unguessable, cleanable later); message row is the source of truth.
- Mock-data mode (`isSupabaseConfigured()` false): no special handling — the button renders, and `send()` already no-ops in mock mode (existing guard), which covers the image path too.

## Testing

1. `npm run build` + `npm run lint` clean.
2. Live (demo accounts, both directions): image-only, image+caption, text-only; Realtime delivery to the other side; thread preview shows `📷 Photo`; storage policy rejects an upload path outside the sender's folder; >10 MB and non-image files rejected.
