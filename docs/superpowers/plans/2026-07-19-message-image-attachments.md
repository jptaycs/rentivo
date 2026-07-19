# Message Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let booking participants attach one image (with optional caption) to chat messages, end-to-end: storage bucket → upload in `send()` → composer UI → bubble rendering → thread preview.

**Architecture:** Client uploads the picked file directly to a new public `message-images` Supabase Storage bucket (path `<uid>/<uuid>.<ext>`), then inserts the `messages` row with `image_url` set — same pattern as avatar/listing-photo uploads. No new API routes or tables. Realtime already fans out the full row including `image_url`.

**Tech Stack:** Next.js 16 / React 19, Supabase JS client + Storage, Tailwind 4, lucide-react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-message-image-attachments-design.md`
- No test framework exists — verification is `npm run build`, `npm run lint`, and a live e2e script using the demo accounts (host `demo@demo.rentivo.ph`, renter `renter@demo.rentivo.ph`, password `DemoRentivo1`).
- Hosted Supabase project ref `prfizruuqwvteqovuqco`; apply migrations with `supabase db push --linked --yes` (ignore pg-delta cert noise; confirm with `supabase migration list --linked`).
- Primary color `#003049`; match existing composer styling in `ConversationView.tsx`.
- One image per message (single `image_url` column). `content` is `not null` — image-only messages store `''`.
- Never use `select('*')` on listings paths — irrelevant here but do not touch `LISTING_COLUMNS`.
- Commit per task, imperative summaries.

---

### Task 1: Storage bucket migration (019)

**Files:**
- Create: `supabase/migrations/019_message_images.sql`

**Interfaces:**
- Produces: public bucket `message-images` (10 MB, jpeg/png/webp/avif) with own-folder insert/delete policies; public read. Task 2 uploads to it.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply to the hosted project**

Run: `supabase db push --linked --yes`
Expected: "Applying migration 019_message_images.sql" (pg-delta cert noise after is normal).

- [ ] **Step 3: Verify the migration landed**

Run: `supabase migration list --linked | tail -3`
Expected: `019` present in both Local and Remote columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/019_message_images.sql
git commit -m "Add message-images storage bucket for chat attachments"
```

---

### Task 2: `send()` accepts an image file

**Files:**
- Modify: `src/hooks/useConversation.ts:116-128` (the `send` function)

**Interfaces:**
- Consumes: bucket `message-images` from Task 1.
- Produces: `send(content: string, imageFile?: File): Promise<string | null>` — returns error string or null. Task 3 calls it with an optional File.

- [ ] **Step 1: Replace the `send` function**

Replace the existing `send` in `src/hooks/useConversation.ts`:

```typescript
  async function send(content: string, imageFile?: File): Promise<string | null> {
    if (!bookingId || !userId) return null
    if (!content.trim() && !imageFile) return null
    const supabase = createClient()

    let imageUrl: string | null = null
    if (imageFile) {
      const ext = imageFile.type.split('/')[1] ?? 'jpg'
      const path = `${userId}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('message-images')
        .upload(path, imageFile, { contentType: imageFile.type })
      if (uploadError) return uploadError.message
      imageUrl = supabase.storage.from('message-images').getPublicUrl(path).data.publicUrl
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({ booking_id: bookingId, sender_id: userId, content: content.trim(), image_url: imageUrl })
      .select()
      .single()
    if (!error && data) {
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    }
    return error?.message ?? null
  }
```

Note: the old guard was `if (!bookingId || !userId || !content.trim()) return null` — the new version must allow empty content when `imageFile` is present. `Message.image_url` already exists in `src/types/index.ts:86`, no type change needed.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | grep -E "error|Compiled" | head -5`
Expected: compiles with no type errors (ConversationView still passes one arg — optional param is backward compatible).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useConversation.ts
git commit -m "Support image upload in conversation send()"
```

---

### Task 3: Composer attach UI + image bubbles

**Files:**
- Modify: `src/components/messages/ConversationView.tsx`

**Interfaces:**
- Consumes: `onSend(text: string, imageFile?: File): Promise<string | null>` (Task 2's signature, passed through the existing `onSend` prop).
- Produces: the complete user-facing feature.

- [ ] **Step 1: Update the props interface**

In `src/components/messages/ConversationView.tsx`, change:

```typescript
  onSend: (text: string) => Promise<string | null>
```

to:

```typescript
  onSend: (text: string, imageFile?: File) => Promise<string | null>
```

- [ ] **Step 2: Add attachment state and update `send()`**

Update the imports line to add icons and `useMemo`:

```typescript
import { useRef, useState, useEffect, useMemo } from 'react'
import { Send, ArrowLeft, CalendarDays, ImagePlus, X } from 'lucide-react'
```

Add state after `const [error, setError] = useState('')`:

```typescript
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrl = useMemo(
    () => (pendingImage ? URL.createObjectURL(pendingImage) : null),
    [pendingImage]
  )
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])
```

In the first `useEffect` (reset on `header.bookingId` change), add `setPendingImage(null)` after `setError('')`.

Replace the `send` function:

```typescript
  async function send() {
    const text = input.trim()
    const image = pendingImage
    if ((!text && !image) || sending) return
    setSending(true)
    setError('')
    setInput('')
    setPendingImage(null)
    const err = await onSend(text, image ?? undefined)
    if (err) {
      setError(err)
      setInput(text)
      setPendingImage(image)
    }
    setSending(false)
  }
```

- [ ] **Step 3: Render image bubbles**

Replace the message bubble block (the `div` with `px-4 py-2.5 rounded-2xl …` containing `{msg.content}`) with:

```tsx
                    <div className={`rounded-2xl text-sm leading-relaxed overflow-hidden ${
                      isMe
                        ? 'bg-[#003049] text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-[#111827] rounded-bl-sm shadow-sm'
                    }`}>
                      {msg.image_url && (
                        <a href={msg.image_url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={msg.image_url}
                            alt="Attached photo"
                            loading="lazy"
                            className="max-h-64 w-full object-cover"
                          />
                        </a>
                      )}
                      {msg.content && <div className="px-4 py-2.5">{msg.content}</div>}
                    </div>
```

Note the padding moved from the bubble to the text `div` so images can bleed edge-to-edge; an image-only bubble has no padded text block.

- [ ] **Step 4: Add the preview chip and attach button to the composer**

Immediately above the `<div className="flex items-center gap-2 bg-[#F8FAFC] …">` composer row, add:

```tsx
        {previewUrl && (
          <div className="mb-2 inline-flex items-start gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Attachment preview" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
            <button
              onClick={() => setPendingImage(null)}
              className="w-5 h-5 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
              aria-label="Remove attachment"
            >
              <X className="w-3 h-3 text-gray-500" />
            </button>
          </div>
        )}
```

Inside the composer row, before the text `<input>`, add:

```tsx
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setPendingImage(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-400 hover:text-[#003049] transition-colors shrink-0"
            aria-label="Attach an image"
          >
            <ImagePlus className="w-4.5 h-4.5" />
          </button>
```

Update the send button's disabled condition from `!input.trim() || sending` to:

```tsx
            disabled={(!input.trim() && !pendingImage) || sending}
```

- [ ] **Step 5: Verify build and lint**

Run: `npm run build 2>&1 | tail -3 && npm run lint 2>&1 | tail -3`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/messages/ConversationView.tsx
git commit -m "Add image attachment UI to conversation composer and bubbles"
```

---

### Task 4: Thread preview shows 📷 Photo

**Files:**
- Modify: `src/hooks/useThreads.ts:66,89`

**Interfaces:**
- Consumes: `messages.image_url` column.
- Produces: `MessageThread.lastMessage` reads `📷 Photo` when the last message is image-only.

- [ ] **Step 1: Add `image_url` to the select and the preview fallback**

In `src/hooks/useThreads.ts` change line 66:

```typescript
      .select('booking_id, content, image_url, sender_id, is_read, created_at')
```

and line 89:

```typescript
          lastMessage: last.content || (last.image_url ? '📷 Photo' : ''),
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useThreads.ts
git commit -m "Show photo placeholder in thread previews for image messages"
```

---

### Task 5: Live e2e verification + docs + deploy

**Files:**
- Create: (scratchpad only) `e2e-message-images.mjs` — not committed
- Modify: `AGENTS.md` (To Do list + messaging note)

**Interfaces:**
- Consumes: everything above, demo accounts, hosted Supabase.

- [ ] **Step 1: Write the e2e script in the scratchpad**

Create `/private/tmp/claude-501/-Users-jptaycs-Documents-GitHub-rentivo/8e8f9273-94d5-4406-b757-9ce175a92fb9/scratchpad/e2e-message-images.mjs` (reads `.env.local` for `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```javascript
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const url = env.NEXT_PUBLIC_SUPABASE_URL, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function signIn(email) {
  const c = createClient(url, anon)
  const { error } = await c.auth.signInWithPassword({ email, password: 'DemoRentivo1' })
  if (error) throw new Error(`${email}: ${error.message}`)
  return c
}

const renter = await signIn('renter@demo.rentivo.ph')
const { data: { user } } = await renter.auth.getUser()

// find a booking the renter is party to
const { data: bookings } = await renter.from('bookings').select('id').eq('renter_id', user.id).limit(1)
if (!bookings?.length) throw new Error('no booking to message on')
const bookingId = bookings[0].id

// 1. upload a tiny png to own folder
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const path = `${user.id}/${crypto.randomUUID()}.png`
const { error: upErr } = await renter.storage.from('message-images').upload(path, png, { contentType: 'image/png' })
console.log('own-folder upload:', upErr ? `FAIL ${upErr.message}` : 'OK')

// 2. foreign-folder upload must be rejected
const { error: foreignErr } = await renter.storage.from('message-images')
  .upload(`00000000-0000-0000-0000-000000000000/x.png`, png, { contentType: 'image/png' })
console.log('foreign-folder rejected:', foreignErr ? 'OK' : 'FAIL — policy did not block')

// 3. image-only message insert
const imageUrl = renter.storage.from('message-images').getPublicUrl(path).data.publicUrl
const { data: msg, error: msgErr } = await renter.from('messages')
  .insert({ booking_id: bookingId, sender_id: user.id, content: '', image_url: imageUrl })
  .select().single()
console.log('image-only message:', msgErr ? `FAIL ${msgErr.message}` : 'OK')

// 4. public URL actually serves
const res = await fetch(imageUrl)
console.log('public URL serves:', res.ok ? 'OK' : `FAIL ${res.status}`)

// 5. host sees it with image_url intact
const host = await signIn('demo@demo.rentivo.ph')
const { data: seen } = await host.from('messages').select('id, image_url, content').eq('id', msg.id).single()
console.log('host sees image message:', seen?.image_url === imageUrl ? 'OK' : 'FAIL')

// cleanup
await renter.from('messages').delete().eq('id', msg.id)
await renter.storage.from('message-images').remove([path])
console.log('cleaned up')
```

- [ ] **Step 2: Run it**

Run: `node /private/tmp/claude-501/-Users-jptaycs-Documents-GitHub-rentivo/8e8f9273-94d5-4406-b757-9ce175a92fb9/scratchpad/e2e-message-images.mjs`
Expected: every line `OK`, then `cleaned up`. (Message delete may be blocked by RLS — if so, note it and clean up via the service key instead; do not weaken RLS.)

- [ ] **Step 3: Manual UI spot-check**

Run `npm run dev`, sign in as `renter@demo.rentivo.ph`, open `/dashboard/messages`, send an image with a caption. Expected: preview chip → bubble with image + caption; thread list shows the caption (or 📷 Photo if none). Optional but ideal: second browser as the host to watch Realtime delivery.

- [ ] **Step 4: Update AGENTS.md**

- To Do: remove the line `- [ ] Image attachments in messages (\`messages.image_url\` column exists, no upload UI yet)` from **Deferred**.
- Done list: add `- [x] Image attachments in messages (019): message-images bucket, attach+preview+caption composer, image bubbles, 📷 Photo thread previews — verified live with demo accounts`.
- Messaging architecture note: append a sentence: `Messages can carry one image (message-images public bucket, <uid>/<uuid>.<ext> paths, 10 MB, upload in useConversation.send() before insert).`

- [ ] **Step 5: Deploy to production**

Run: `vercel deploy --prod --yes 2>&1 | grep message`
Expected: `"Deployment … ready."` — then spot-check `https://rentivo-taupe.vercel.app/dashboard/messages` loads.

- [ ] **Step 6: Commit and push**

```bash
git add AGENTS.md
git commit -m "Wire image attachments in messages end-to-end"
git push
```
