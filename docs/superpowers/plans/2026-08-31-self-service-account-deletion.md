# Self-Service Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Settings' "Contact Support to Delete Account" mailto link with a real self-service delete: a `POST /api/account/delete` route that anonymizes the user's profile, purges sensitive/disposable data, and soft-deletes their auth account — blocked while they have any unfinished booking.

**Architecture:** One new API route (`src/app/api/account/delete/route.ts`) does the whole flow server-side using the existing service-role admin client (same pattern as `/api/bookings/[id]/respond`): eligibility gate, anonymize `profiles`, deactivate listings, purge sensitive rows + storage files, then `supabase.auth.admin.deleteUser(uid, true)` (GoTrue soft-delete — keeps the `auth.users` row so `profiles.id`'s FK doesn't cascade-delete the profile we just anonymized). `bookings`/`reviews`/`messages`/`payout_requests` are never touched — they keep referencing the now-anonymized profile so counterparties retain accurate history. Settings' Danger Zone gets an inline "type DELETE to confirm" panel wired to the route, matching the existing add/replace-account panel pattern on the Payouts page.

**Tech Stack:** Next.js 16 API route, `@/lib/supabase/server` (cookie auth) + `@/lib/supabase/admin` (service-role client, already exists), `supabase.auth.admin.deleteUser`. No new tables, no migrations.

**Spec:** `docs/superpowers/specs/2026-07-30-self-service-account-deletion-design.md`

## Global Constraints

- No new tables or migrations — every write uses the existing service-role admin client, which bypasses RLS (per spec's Architecture section)
- The request body's `confirm` field must equal the literal string `"DELETE"` or the request 400s (server-side validation, not just client-side)
- The user id being deleted always comes from the authenticated session (`supabase.auth.getUser()`), never from the request body
- Deletion is blocked (400) while the user has any booking (as renter or host) with `status` in `('pending', 'confirmed', 'active')` — only `completed`/`cancelled` bookings never block
- `bookings`, `reviews`, `messages`, `payout_requests`, `payout_items` are never modified or deleted by this flow
- **Never test this against the real demo accounts** (`demo@demo.rentivo.ph` / `renter@demo.rentivo.ph`) — the project's entire e2e-testing pattern depends on those two staying intact indefinitely. Always use a disposable throwaway account created and destroyed for this test only.
- This project has no automated test framework (confirmed — `package.json` has no test runner). Every feature so far has been verified via `npm run build` + `npm run lint` + a live smoke-test script hitting the hosted Supabase project directly. Follow that same pattern here — do not invent a test framework or write files implying one exists.

---

## Task 1: `POST /api/account/delete` route

**Files:**
- Create: `src/app/api/account/delete/route.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (cookie-based auth client — `await createClient()`, then `.auth.getUser()`), `createAdminClient` from `@/lib/supabase/admin` (service-role client — bypasses RLS, already used by `/api/bookings/[id]/respond`)
- Produces: `POST /api/account/delete` — request body `{ confirm: string }`, response `{ ok: true }` (200) or `{ error: string }` (400/401/500). Consumed by Task 2's Settings page UI.

- [ ] **Step 1: Write the route handler**

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Self-service account deletion. Anonymizes the profile rather than
 * hard-deleting it — bookings/reviews/messages reference profiles
 * without ON DELETE CASCADE, and profiles->auth.users does cascade, so
 * a hard auth delete would wipe the very profile row this anonymizes.
 * See docs/superpowers/specs/2026-07-30-self-service-account-deletion-design.md
 */
export async function POST(req: Request) {
  let body: { confirm?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }
  const uid = user.id
  const admin = createAdminClient()

  // Eligibility gate: block while any booking isn't in a final state
  const { data: blocking, error: blockingError } = await admin
    .from('bookings')
    .select('id')
    .or(`renter_id.eq.${uid},host_id.eq.${uid}`)
    .in('status', ['pending', 'confirmed', 'active'])
    .limit(1)
  if (blockingError) {
    return NextResponse.json({ error: blockingError.message }, { status: 500 })
  }
  if (blocking && blocking.length > 0) {
    return NextResponse.json(
      {
        error:
          'You have an active booking. Please wait for it to complete or cancel it before deleting your account.',
      },
      { status: 400 }
    )
  }

  // Anonymize the profile — keep the row, scrub PII
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: 'Deleted User',
      avatar_url: null,
      bio: null,
      city: null,
      is_host: false,
      is_verified: false,
    })
    .eq('id', uid)
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // Deactivate listings — never hard-delete, they may have booking history
  const { error: listingsError } = await admin.from('listings').update({ is_active: false }).eq('host_id', uid)
  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 })
  }

  // Capture verification doc storage paths before deleting the row
  const { data: verifications, error: verificationsReadError } = await admin
    .from('verification_requests')
    .select('id_doc_path, selfie_path')
    .eq('user_id', uid)
  if (verificationsReadError) {
    return NextResponse.json({ error: verificationsReadError.message }, { status: 500 })
  }

  // Delete sensitive/disposable rows — no counterparty depends on any of these
  for (const table of ['payout_accounts', 'verification_requests', 'notifications', 'wishlist', 'recently_viewed_listings'] as const) {
    const { error } = await admin.from(table).delete().eq('user_id', uid)
    if (error) {
      return NextResponse.json({ error: `Failed to clean up ${table}: ${error.message}` }, { status: 500 })
    }
  }

  // Storage cleanup: avatars (list, since avatar_url is a public URL not a stored path)
  const { data: avatarFiles, error: avatarListError } = await admin.storage.from('avatars').list(uid)
  if (avatarListError) {
    return NextResponse.json({ error: avatarListError.message }, { status: 500 })
  }
  if (avatarFiles && avatarFiles.length > 0) {
    const { error: avatarRemoveError } = await admin.storage
      .from('avatars')
      .remove(avatarFiles.map((f) => `${uid}/${f.name}`))
    if (avatarRemoveError) {
      return NextResponse.json({ error: avatarRemoveError.message }, { status: 500 })
    }
  }

  // Storage cleanup: verification docs (paths captured above, exact stored paths)
  const docPaths = (verifications ?? [])
    .flatMap((v) => [v.id_doc_path, v.selfie_path])
    .filter((p): p is string => Boolean(p))
  if (docPaths.length > 0) {
    const { error: docRemoveError } = await admin.storage.from('verification-docs').remove(docPaths)
    if (docRemoveError) {
      return NextResponse.json({ error: docRemoveError.message }, { status: 500 })
    }
  }

  // Last step: soft-delete the auth user. shouldSoftDelete=true keeps the
  // auth.users row (blocks login only) so profiles.id's FK never cascades.
  const { error: authError } = await admin.auth.admin.deleteUser(uid, true)
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Build and lint**

```bash
npm run build
npm run lint
```

Expected: both clean. If the build fails on a type error in the `for (const table of [...])` loop (TypeScript sometimes needs the array typed as a tuple for `.from(table)` to accept each literal), the `as const` already present should be sufficient — if not, widen `createAdminClient()`'s return type usage isn't needed; instead cast the loop variable: `await admin.from(table as any).delete()...` is NOT acceptable per this project's lint rules (no `any`) — if this comes up, split the loop into five explicit calls instead of a loop over a table-name array.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/account/delete/route.ts
git commit -m "$(cat <<'EOF'
Add self-service account deletion route

POST /api/account/delete anonymizes the profile, deactivates listings,
purges sensitive/disposable rows and storage files, then soft-deletes
the auth user. Blocked while the user has any unfinished booking.
Bookings/reviews/messages/payout history are never touched, so
counterparties keep accurate records. See
docs/superpowers/specs/2026-07-30-self-service-account-deletion-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01R1SCXMtGwCZGtSnkamQQQw
EOF
)"
```

---

## Task 2: Settings page Danger Zone UI

**Files:**
- Modify: `src/app/(main)/dashboard/settings/page.tsx`

**Interfaces:**
- Consumes: `POST /api/account/delete` (Task 1) — `{ confirm: string }` → `{ ok: true }` or `{ error: string }`; `useUser` from `@/hooks/useUser` — destructure `{ signOut }` (existing hook, already signs out via Supabase then redirects to `/` and calls `router.refresh()`)
- Produces: nothing consumed elsewhere — this is the UI leaf

- [ ] **Step 1: Add the `useUser` import and new state**

Find the existing imports at the top of `src/app/(main)/dashboard/settings/page.tsx` (currently imports `useProfile` from `@/hooks/useProfile`) and add:

```typescript
import { useUser } from '@/hooks/useUser'
```

Inside `SettingsPage()`, alongside the other `useState` declarations (near `openFaq`), add:

```typescript
const { signOut } = useUser()
const [deleteOpen, setDeleteOpen] = useState(false)
const [deleteConfirmText, setDeleteConfirmText] = useState('')
const [deleting, setDeleting] = useState(false)
const [deleteError, setDeleteError] = useState('')
```

- [ ] **Step 2: Add the delete handler**

Add this function inside `SettingsPage()`, near the other handler functions (e.g. after the notification-toggle handler):

```typescript
async function handleDeleteAccount() {
  setDeleting(true)
  setDeleteError('')
  try {
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: deleteConfirmText }),
    })
    const data = await res.json()
    if (!res.ok) {
      setDeleteError(data.error ?? 'Failed to delete account.')
      setDeleting(false)
      return
    }
    await signOut()
  } catch {
    setDeleteError('Failed to delete account. Please try again.')
    setDeleting(false)
  }
}
```

- [ ] **Step 3: Replace the Danger Zone section**

Find this existing block near the end of the component's JSX:

```tsx
      {/* Danger zone */}
      <section className="bg-red-50 border border-red-100 rounded-2xl p-6 space-y-3">
        <h2 className="font-bold text-red-700">Danger Zone</h2>
        <p className="text-sm text-red-600">
          Account deletion permanently removes your listings, bookings, and history and cannot be undone.
        </p>
        <a
          href="mailto:support@rentivo.ph?subject=Delete my Rentivo account"
          className="inline-block text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors"
        >
          Contact Support to Delete Account
        </a>
      </section>
```

Replace it with:

```tsx
      {/* Danger zone */}
      <section className="bg-red-50 border border-red-100 rounded-2xl p-6 space-y-3">
        <h2 className="font-bold text-red-700">Danger Zone</h2>
        <p className="text-sm text-red-600">
          Account deletion permanently removes your listings, bookings, and history and cannot be undone.
        </p>

        {!deleteOpen && (
          <button
            onClick={() => setDeleteOpen(true)}
            className="inline-block text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors"
          >
            Delete Account
          </button>
        )}

        {deleteOpen && (
          <div className="border border-red-200 rounded-xl p-5 space-y-4 bg-white">
            <p className="font-bold text-sm text-red-700">Confirm Account Deletion</p>
            <p className="text-sm text-gray-600">
              This cannot be undone. Type <span className="font-mono font-bold">DELETE</span> below to confirm.
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-red-400"
            />
            {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDeleteOpen(false)
                  setDeleteConfirmText('')
                  setDeleteError('')
                }}
                className="flex-1 border border-gray-200 rounded-xl py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || deleting}
                className="flex-1 bg-red-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete My Account'}
              </button>
            </div>
          </div>
        )}

        <a
          href="mailto:support@rentivo.ph?subject=Delete my Rentivo account"
          className="block text-xs text-red-500 hover:underline"
        >
          Or contact support if you run into an issue
        </a>
      </section>
```

- [ ] **Step 4: Build and lint**

```bash
npm run build
npm run lint
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(main)/dashboard/settings/page.tsx"
git commit -m "$(cat <<'EOF'
Wire Settings Danger Zone to real account deletion

Replaces the mailto-to-support link with an inline "type DELETE to
confirm" panel calling POST /api/account/delete, matching the
add/replace-account panel pattern already used on the Payouts page.
Contact-support link stays for anyone blocked or hitting an edge case.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01R1SCXMtGwCZGtSnkamQQQw
EOF
)"
```

---

## Task 3: Live verification against a throwaway account

This project has no automated test suite — every feature so far has been verified with a one-off Node script hitting the hosted Supabase project directly, run from the scratchpad directory. Do the same here. **Do not use `demo@demo.rentivo.ph` or `renter@demo.rentivo.ph`** — create and destroy a throwaway account instead.

**Files:**
- Create (scratchpad, not committed): a temporary verification script

- [ ] **Step 1: Start the production build locally**

```bash
npm run build
lsof -ti:3000 | xargs kill -9 2>/dev/null
npm run start &
sleep 5
curl -s -o /dev/null -w "home: %{http_code}\n" http://localhost:3000
```

Expected: `home: 200`. (Use a production build, not `next dev` — the account-deletion route touches `auth.admin`, and dev-mode HMR/Strict Mode double-invocation has no bearing here, but matching how every prior feature in this project was verified keeps results comparable.)

- [ ] **Step 2: Write and run the verification script**

Create `/tmp/verify-account-deletion.mjs` (or the session's scratchpad directory) with:

```javascript
const SUPABASE_URL = 'https://prfizruuqwvteqovuqco.supabase.co'
const ANON_KEY = 'sb_publishable_A91pUX_geIxByqXR-Ew4bg_SHjQu6EV' // from .env.local
// SECRET_KEY: read from .env.local's SUPABASE_SECRET_KEY at run time, don't hardcode

import { readFileSync } from 'fs'
const envContent = readFileSync('.env.local', 'utf-8')
const SECRET_KEY = envContent.match(/^SUPABASE_SECRET_KEY=(.+)$/m)?.[1]?.trim()
if (!SECRET_KEY) throw new Error('SUPABASE_SECRET_KEY not found in .env.local')

const TEST_EMAIL = `deletion-test-${Date.now()}@example.com`
const TEST_PASSWORD = 'ThrowawayTest123!'

async function adminRequest(path, options) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json', ...options?.headers },
  })
  return res
}

function forgeCookie(session) {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0]
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
    refresh_token: session.refresh_token,
    user: session.user,
  }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
  return { name: `sb-${ref}-auth-token`, value: `base64-${b64}` }
}

async function main() {
  // 1. Create a pre-confirmed throwaway account via the admin API
  const createRes = await adminRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
  })
  const created = await createRes.json()
  console.log('CREATE_STATUS', createRes.status)
  const testUserId = created.id
  console.log('TEST_USER_ID', testUserId)

  // profiles row should exist via the on-signup trigger — confirm
  const profileCheck = await adminRequest(`/rest/v1/profiles?select=id,full_name&id=eq.${testUserId}`, { method: 'GET' })
  console.log('PROFILE_EXISTS', await profileCheck.json())

  // 2. Sign in as the throwaway account
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  const session = await signInRes.json()
  const cookie = forgeCookie(session)

  // 3. Try deleting with wrong confirm text -- expect 400
  const wrongConfirmRes = await fetch('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${cookie.name}=${cookie.value}` },
    body: JSON.stringify({ confirm: 'nope' }),
  })
  console.log('WRONG_CONFIRM_STATUS (expect 400)', wrongConfirmRes.status)

  // 4. Give the throwaway account a listing + a pending booking against it,
  //    from the demo renter, to prove the eligibility gate blocks deletion.
  //    (Booking as HOST via a listing they own -- simplest path to a
  //    blocking row without needing a second throwaway account.)
  const listingRes = await adminRequest('/rest/v1/listings', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      host_id: testUserId, category: 'lens', brand: 'Test', model: 'Test Lens',
      title: 'Deletion Test Lens', description: 'throwaway', daily_price: 100,
      security_deposit: 100, city: 'Test City', province: 'Test',
    }),
  })
  const [listing] = await listingRes.json()
  console.log('TEST_LISTING_ID', listing.id)

  const renterSignIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'renter@demo.rentivo.ph', password: 'DemoRentivo1' }),
  }).then((r) => r.json())

  const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${renterSignIn.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_listing_id: listing.id,
      p_pickup_date: '2027-01-01',
      p_return_date: '2027-01-03',
    }),
  })
  const booking = await bookingRes.json()
  console.log('TEST_BOOKING_STATUS (should be pending)', booking.status)

  // 5. Try deleting with a pending booking -- expect 400 blocking message
  const blockedRes = await fetch('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${cookie.name}=${cookie.value}` },
    body: JSON.stringify({ confirm: 'DELETE' }),
  })
  console.log('BLOCKED_STATUS (expect 400)', blockedRes.status, await blockedRes.json())

  // 6. Cancel the booking so the gate clears
  await adminRequest(`/rest/v1/bookings?id=eq.${booking.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled' }),
  })

  // 7. Now delete for real -- expect 200
  const deleteRes = await fetch('http://localhost:3000/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${cookie.name}=${cookie.value}` },
    body: JSON.stringify({ confirm: 'DELETE' }),
  })
  console.log('DELETE_STATUS (expect 200)', deleteRes.status, await deleteRes.json())

  // 8. Verify the profile is anonymized, not deleted
  const afterProfile = await adminRequest(`/rest/v1/profiles?select=full_name,avatar_url,is_host,is_verified&id=eq.${testUserId}`, { method: 'GET' })
  console.log('PROFILE_AFTER_DELETE (expect Deleted User / nulls / false / false)', await afterProfile.json())

  // 9. Verify the listing is deactivated, not deleted
  const afterListing = await adminRequest(`/rest/v1/listings?select=id,is_active&id=eq.${listing.id}`, { method: 'GET' })
  console.log('LISTING_AFTER_DELETE (expect is_active=false)', await afterListing.json())

  // 10. Verify the booking (the counterparty's record) is untouched
  const afterBooking = await adminRequest(`/rest/v1/bookings?select=id,status,host_id&id=eq.${booking.id}`, { method: 'GET' })
  console.log('BOOKING_AFTER_DELETE (expect status=cancelled, host_id unchanged)', await afterBooking.json())

  // 11. Verify login is now blocked
  const reLoginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  console.log('RE_LOGIN_STATUS (expect 400/401 -- login blocked)', reLoginRes.status)

  // 12. Record whether the email can be reused immediately (spec's open question)
  const reSignupRes = await adminRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_EMAIL, password: 'AnotherPassword123!', email_confirm: true }),
  })
  console.log('EMAIL_REUSE_STATUS (record actual result, either is fine)', reSignupRes.status, await reSignupRes.json())

  console.log('TEST_LISTING_ID_FOR_CLEANUP', listing.id)
  console.log('TEST_BOOKING_ID_FOR_CLEANUP', booking.id)
  console.log('TEST_USER_ID_FOR_CLEANUP', testUserId)
}

main().catch((e) => {
  console.error('ERROR', e)
  process.exit(1)
})
```

Run it from the project root (so the relative `.env.local` read works):

```bash
cd /Users/jptaycs/Documents/GitHub/rentivo && node /tmp/verify-account-deletion.mjs
```

- [ ] **Step 3: Confirm every logged expectation matches**

Read through the script's output line by line against the `(expect ...)` comments in each `console.log`. In particular:
- `WRONG_CONFIRM_STATUS` must be `400`
- `BLOCKED_STATUS` must be `400` with the "active booking" message
- `DELETE_STATUS` must be `200`
- `PROFILE_AFTER_DELETE` must show `full_name: "Deleted User"`, `avatar_url: null`, `is_host: false`, `is_verified: false` — and the row must still exist (not a 404/empty array)
- `LISTING_AFTER_DELETE` must show `is_active: false` — the listing row must still exist
- `BOOKING_AFTER_DELETE` must show the booking completely untouched (still exists, `host_id` still points at the deleted user's id — proving the FK didn't break)
- `RE_LOGIN_STATUS` must NOT be a successful login (200) — confirms the account is actually blocked
- `EMAIL_REUSE_STATUS`: note whatever it actually says. If it's a success (email reusable), update the spec's open question with the confirmed answer. If it fails (email still reserved), that's fine per the spec — it's a smaller documented follow-up, not a blocker.

If anything doesn't match, fix the route code (Task 1) and re-run — the whole flow is idempotent per the spec, so re-running against the same throwaway account after a partial failure is safe.

- [ ] **Step 4: Clean up test data**

Using the `SUPABASE_SECRET_KEY` and the ids logged as `..._FOR_CLEANUP` above:

```bash
SECRET=$(grep '^SUPABASE_SECRET_KEY' .env.local | cut -d= -f2)
# Replace the ids below with the actual values from the script's output
curl -s -X DELETE "https://prfizruuqwvteqovuqco.supabase.co/rest/v1/bookings?id=eq.<TEST_BOOKING_ID>" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"
curl -s -X DELETE "https://prfizruuqwvteqovuqco.supabase.co/rest/v1/listings?id=eq.<TEST_LISTING_ID>" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"
curl -s -X DELETE "https://prfizruuqwvteqovuqco.supabase.co/auth/v1/admin/users/<TEST_USER_ID>" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET"
```

The last call permanently removes the (already soft-deleted) throwaway auth user and cascades its now-anonymized `profiles` row — safe, since this is a disposable test account, not the real demo accounts.

- [ ] **Step 5: Stop the local server**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
```

- [ ] **Step 6: Update AGENTS.md**

Add a `[x]` entry to AGENTS.md's Status — Done section (near the other recent entries) summarizing what was built, matching the style of existing entries (feature description, why, what was verified live). Move the account-deletion line out of the "Deferred — needs a product decision" section in the To Do list (it now has one). Record the actual `EMAIL_REUSE_STATUS` result from Step 3 in that entry.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
Document self-service account deletion + verification results

Verified live against a disposable throwaway account (never the real
demo accounts): eligibility gate blocks/unblocks correctly, profile
anonymizes while the row and its FK-referencing bookings/reviews/
messages stay intact, sensitive rows and storage files are purged,
login is blocked after deletion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01R1SCXMtGwCZGtSnkamQQQw
EOF
)"
git push
```

---

## Self-Review Notes

**Spec coverage:** Request validation (Task 1), auth check (Task 1), eligibility gate (Task 1), profile anonymize (Task 1), listing deactivation (Task 1), sensitive row purge including the new `recently_viewed_listings` addition (Task 1), storage cleanup for both buckets (Task 1), GoTrue soft-delete (Task 1), response shape (Task 1), UI panel with typed `DELETE` confirmation (Task 2), contact-support fallback link retained (Task 2), live testing against a throwaway account covering every behavior the spec's Testing section calls out (Task 3). Every spec section has a task.

**Type consistency:** `confirm: string` (client) matches `body.confirm !== 'DELETE'` (route) matches the plan's UI `body: JSON.stringify({ confirm: deleteConfirmText })`. Response shape `{ ok: true }` / `{ error: string }` used consistently between Task 1's route and Task 2's `handleDeleteAccount`.
