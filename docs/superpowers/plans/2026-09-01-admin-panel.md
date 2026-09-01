# Admin Panel (`/admin`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web admin panel at `/admin` (env-allowlisted) that replaces the SQL editor for identity-verification review and payout administration, sending the affected user an outcome email on every decision.

**Architecture:** New `src/app/admin/` route group (server components fetching via the existing service-role client after a `requireAdminPage()` guard) + four thin `POST /api/admin/…` routes that call the four **existing, unchanged** service-role RPCs and fire outcome emails. Access control is a server-only `ADMIN_EMAILS` env allowlist — nothing admin-related is stored in the database (see the grant-audit ⚠️ note in AGENTS.md for why).

**Tech Stack:** Next.js 16 App Router, Supabase (service-role client `src/lib/supabase/admin.ts`), Resend via `src/lib/email.ts`, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-01-admin-panel-design.md`

## Global Constraints

- **No new migrations.** The RPCs (`review_verification_request`, `review_payout_account`, `mark_payout_paid`, `mark_payout_failed`) already exist, service-role-granted. The panel is only a new caller.
- **404, never 403,** for non-admins on every admin page and API route — the panel's existence is not advertised.
- Defense in depth: middleware check is convenience only; `requireAdminPage()` runs in the admin layout and `requireAdminApi()` at the top of **every** admin API route, before any data fetch.
- Fails closed: empty/unset `ADMIN_EMAILS` → everything 404s.
- Emails are fire-and-forget, non-fatal, no-op without `RESEND_API_KEY` — never fail the admin action.
- Signed URLs for verification docs: short-lived (600s), minted only inside admin-gated server code.
- This repo has **no unit-test framework**; the verification cycle per task is `npm run build` + `npm run lint` + live checks against `npm run dev` using the documented demo-account pattern (AGENTS.md → "E2E test pattern"). Local `.env.local` adds `demo@demo.rentivo.ph` to `ADMIN_EMAILS` for e2e; **Vercel production gets only the owner's email**.
- Brand: primary `#003049`, background `#F8FAFC`, ₱ formatting `₱X,XXX`. Currency amounts in payout tables are integer pesos.
- Commits: imperative summaries, one per task.

## Reference: existing signatures the plan builds on

- `createClient()` from `@/lib/supabase/server` — cookie-session (anon) server client.
- `createAdminClient()` from `@/lib/supabase/admin` — service-role client, `admin.rpc(name, args)`, `admin.storage.from(bucket).createSignedUrls(paths, seconds)`, `admin.auth.admin.getUserById(id)`.
- RPCs (all return the updated row as a single object from `.rpc()`):
  - `review_verification_request(p_request_id uuid, p_approve boolean, p_notes text default null)` → `verification_requests` row (`{id, user_id, id_doc_path, selfie_path, status, reviewer_notes, created_at, reviewed_at}`)
  - `review_payout_account(p_account_id uuid, p_approve boolean, p_notes text default null)` → `payout_accounts` row (`{id, user_id, method, account_number, account_name, status, reviewer_notes, created_at, reviewed_at}`)
  - `mark_payout_paid(p_request_id uuid, p_reference text default null)` → `payout_requests` row (`{id, host_id, payout_account_id, amount, status, reference, notes, requested_at, processed_at}`)
  - `mark_payout_failed(p_request_id uuid, p_notes text default null)` → `payout_requests` row
- `src/lib/email.ts` internals used by new senders: `layout(preheader, bodyHtml)`, `button(href, label)`, `escapeHtml(value)`, `send(to, subject, html)`, `fmtPeso(n)`, `APP_URL`, `createAdminClient`.
- Storage: verification docs live in the private `verification-docs` bucket at the paths stored in `id_doc_path` / `selfie_path`.

---

### Task 1: Admin auth core (allowlist helper, guards, middleware, env)

**Files:**
- Create: `src/lib/admin-emails.ts`
- Create: `src/lib/admin.ts`
- Modify: `src/lib/supabase/middleware.ts` (PROTECTED_PREFIXES at line 43; add admin check after the `!user && isProtected` block)
- Modify: `.env.local` (gitignored — add `ADMIN_EMAILS` with a placeholder comment, matching the file's existing commented-placeholder style)

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`.
- Produces: `isAdminEmail(email: string | null | undefined): boolean` (pure, importable from middleware); `requireAdminPage(): Promise<User>` (pages/layouts — calls `notFound()` for non-admins); `requireAdminApi(): Promise<User | NextResponse>` (API routes — returns a 404 `NextResponse` for non-admins; callers `if (gate instanceof NextResponse) return gate`).

- [ ] **Step 1: Create the pure allowlist helper** (separate file so middleware can import it without pulling `next/headers`):

```ts
// src/lib/admin-emails.ts
/**
 * Server-only admin allowlist (ADMIN_EMAILS env var, comma-separated).
 * Deliberately env-based, not a DB flag — see the grant-audit note in
 * AGENTS.md: nothing self-grantable may live in the database.
 * Unset/empty var ⇒ always false (the admin panel fails closed).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}
```

- [ ] **Step 2: Create the server guards:**

```ts
// src/lib/admin.ts
import 'server-only'
import { notFound } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin-emails'

/** Pages/layouts: returns the admin user, or renders the 404 page. */
export async function requireAdminPage(): Promise<User> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) notFound()
  return user!
}

/**
 * API routes: returns the admin user, or a 404 JSON response the caller
 * must return as-is (404, not 403 — the panel isn't advertised).
 */
export async function requireAdminApi(): Promise<User | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return user
}
```

- [ ] **Step 3: Wire the middleware.** In `src/lib/supabase/middleware.ts`: import `isAdminEmail` from `@/lib/admin-emails`; change the last line to `const PROTECTED_PREFIXES = ['/dashboard', '/host', '/book', '/messages', '/admin']`; and after the existing `if (!user && isProtected)` redirect block, add:

```ts
  // /admin is allowlist-only. Convenience layer — requireAdminPage()/
  // requireAdminApi() re-check server-side; this is never the sole gate.
  const isAdminPath = path === '/admin' || path.startsWith('/admin/')
  if (isAdminPath && user && !isAdminEmail(user.email)) {
    return new NextResponse('Not Found', { status: 404 })
  }
```

- [ ] **Step 4: Add the env var.** Append to `.env.local` (style-matched to its existing commented placeholders):

```
# Admin panel access — comma-separated allowlist of admin account emails.
# Local dev includes the demo host so e2e tests can drive /admin;
# Vercel production must contain ONLY the owner's real email.
ADMIN_EMAILS=jptayco1109@gmail.com,demo@demo.rentivo.ph
```

- [ ] **Step 5: Verify.** Run `npm run build` (expect: clean) and `npm run lint` (expect: clean). Then with `npm run dev` running:
  - Signed-out: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin` → expect **307** (login redirect; `/admin` page itself doesn't exist yet — the redirect proves the prefix guard fires before any 404).
  - Signed-in non-admin (forge the demo **renter** cookie per AGENTS.md's e2e pattern: POST `{SUPABASE_URL}/auth/v1/token?grant_type=password` with `renter@demo.rentivo.ph` / `DemoRentivo1` + apikey header, then send `Cookie: sb-prfizruuqwvteqovuqco-auth-token=base64-<base64url(session JSON)>`): `curl` to `http://localhost:3000/admin` → expect **404** from the middleware.

- [ ] **Step 6: Commit** — `git add src/lib/admin-emails.ts src/lib/admin.ts src/lib/supabase/middleware.ts && git commit -m "Add ADMIN_EMAILS allowlist guards and /admin route protection"`

---

### Task 2: Outcome email senders

**Files:**
- Modify: `src/lib/email.ts` (append four HTML builders + four exported senders at the end of the file, following the file's existing structure)

**Interfaces:**
- Consumes: `layout`, `button`, `escapeHtml`, `send`, `fmtPeso`, `APP_URL`, `createAdminClient` — all already defined in `email.ts`.
- Produces (used by Tasks 3–4):
  - `notifyVerificationReviewed(userId: string, approved: boolean, notes: string | null): Promise<void>`
  - `notifyPayoutAccountReviewed(hostId: string, approved: boolean, notes: string | null): Promise<void>`
  - `notifyPayoutPaid(hostId: string, amount: number, reference: string | null): Promise<void>`
  - `notifyPayoutFailed(hostId: string, amount: number, notes: string | null): Promise<void>`

- [ ] **Step 1: Append the four senders to `src/lib/email.ts`:**

```ts
// ── Admin-decision outcome emails ─────────────────────────────
// Unconditional (no notification-preference gate) — these are
// decision receipts, same rationale as the renter payment email.

function adminDecisionHtml(opts: {
  heading: string
  bodyHtml: string
  ctaPath: string
  ctaLabel: string
}) {
  return layout(
    opts.heading,
    `<h1 style="margin:0 0 12px;color:#111827;font-size:20px;">${opts.heading}</h1>
     ${opts.bodyHtml}
     ${button(`${APP_URL}${opts.ctaPath}`, opts.ctaLabel)}`
  )
}

async function emailForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  return data.user?.email ?? null
}

const notesBlock = (notes: string | null) =>
  notes
    ? `<p style="margin:16px 0 0;color:#4b5563;font-size:14px;line-height:1.6;">Reviewer notes: ${escapeHtml(notes)}</p>`
    : ''

export async function notifyVerificationReviewed(
  userId: string,
  approved: boolean,
  notes: string | null
) {
  const to = await emailForUser(userId)
  if (!to) return
  await send(
    to,
    approved ? 'Your identity is verified ✅' : 'Your identity verification needs another look',
    adminDecisionHtml({
      heading: approved ? 'Identity Verified ✅' : 'Verification Not Approved',
      bodyHtml: approved
        ? `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your identity documents were approved — your account now shows the Verified badge.</p>`
        : `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">We couldn't approve your identity documents this time. You can resubmit from Settings.</p>${notesBlock(notes)}`,
      ctaPath: '/dashboard/settings',
      ctaLabel: approved ? 'View Your Profile Settings' : 'Resubmit Documents',
    })
  )
}

export async function notifyPayoutAccountReviewed(
  hostId: string,
  approved: boolean,
  notes: string | null
) {
  const to = await emailForUser(hostId)
  if (!to) return
  await send(
    to,
    approved ? 'Your payout account is verified' : 'Your payout account was not approved',
    adminDecisionHtml({
      heading: approved ? 'Payout Account Verified ✅' : 'Payout Account Not Approved',
      bodyHtml: approved
        ? `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Your payout account was verified — you can now request payouts for your completed bookings.</p>`
        : `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">We couldn't verify your payout account. Please update it and it will be re-reviewed.</p>${notesBlock(notes)}`,
      ctaPath: '/dashboard/payouts',
      ctaLabel: 'Go to Payouts',
    })
  )
}

export async function notifyPayoutPaid(hostId: string, amount: number, reference: string | null) {
  const to = await emailForUser(hostId)
  if (!to) return
  await send(
    to,
    `Your payout of ${fmtPeso(amount)} has been sent`,
    adminDecisionHtml({
      heading: 'Payout Sent 💸',
      bodyHtml: `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">
          Your payout of <strong>${fmtPeso(amount)}</strong> has been sent to your payout account.
          ${reference ? `<br>Reference: ${escapeHtml(reference)}` : ''}
        </p>`,
      ctaPath: '/dashboard/payouts',
      ctaLabel: 'View Payout History',
    })
  )
}

export async function notifyPayoutFailed(hostId: string, amount: number, notes: string | null) {
  const to = await emailForUser(hostId)
  if (!to) return
  await send(
    to,
    `Your payout of ${fmtPeso(amount)} could not be completed`,
    adminDecisionHtml({
      heading: 'Payout Failed',
      bodyHtml: `<p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">
          Your payout of <strong>${fmtPeso(amount)}</strong> couldn't be completed. The bookings it covered
          are eligible again — please check your payout account details and request again.
        </p>${notesBlock(notes)}`,
      ctaPath: '/dashboard/payouts',
      ctaLabel: 'Go to Payouts',
    })
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` and `npm run lint` both clean. (Live send attempts are exercised in Tasks 3–4 and the final e2e pass; without a key each call logs `[email] RESEND_API_KEY not set — skipped …`.)

- [ ] **Step 3: Commit** — `git add src/lib/email.ts && git commit -m "Add admin-decision outcome email senders"`

---

### Task 3: Verification review API route

**Files:**
- Create: `src/app/api/admin/verifications/[id]/review/route.ts`

**Interfaces:**
- Consumes: `requireAdminApi()` (Task 1), `notifyVerificationReviewed()` (Task 2), `createAdminClient()`, RPC `review_verification_request`.
- Produces: `POST /api/admin/verifications/:id/review` body `{ approve: boolean, notes?: string }` → `200 { request: <verification_requests row> }`, `400 { error }` on bad body or RPC error, `404` for non-admins. Task 6's client component calls this.

- [ ] **Step 1: Write the route:**

```ts
// src/app/api/admin/verifications/[id]/review/route.ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyVerificationReviewed } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { approve?: boolean; notes?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (typeof body.approve !== 'boolean') {
    return NextResponse.json({ error: 'approve (boolean) is required.' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null

  const admin = createAdminClient()
  const { data: request, error } = await admin.rpc('review_verification_request', {
    p_request_id: id,
    p_approve: body.approve,
    p_notes: notes,
  })
  if (error || !request) {
    return NextResponse.json({ error: error?.message ?? 'Review failed.' }, { status: 400 })
  }

  notifyVerificationReviewed(request.user_id, body.approve, notes).catch((e) =>
    console.error('[email] notifyVerificationReviewed failed', e)
  )

  return NextResponse.json({ request })
}
```

- [ ] **Step 2: Verify live** (dev server running; forged cookies per AGENTS.md e2e pattern):
  - Non-admin (demo **renter** cookie): `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/admin/verifications/00000000-0000-0000-0000-000000000000/review -H 'Content-Type: application/json' -H "Cookie: $RENTER_COOKIE" -d '{"approve":true}'` → **404**.
  - Signed out (no cookie): same call → **404** (requireAdminApi has no user).
  - Admin (demo **host** cookie, `demo@demo.rentivo.ph` — in local `ADMIN_EMAILS`): same call with a random UUID → **400** with `Verification request not found.` (proves the gate passed and the RPC ran).
  - Real approve/reject happens in the Task 8 e2e pass with a real submission.

- [ ] **Step 3: Verify build** — `npm run build` and `npm run lint` clean.

- [ ] **Step 4: Commit** — `git add src/app/api/admin/verifications && git commit -m "Add admin verification-review API route"`

---

### Task 4: Payout admin API routes (account review, mark paid, mark failed)

**Files:**
- Create: `src/app/api/admin/payout-accounts/[id]/review/route.ts`
- Create: `src/app/api/admin/payout-requests/[id]/paid/route.ts`
- Create: `src/app/api/admin/payout-requests/[id]/failed/route.ts`

**Interfaces:**
- Consumes: `requireAdminApi()`, `notifyPayoutAccountReviewed()` / `notifyPayoutPaid()` / `notifyPayoutFailed()`, `createAdminClient()`, RPCs `review_payout_account` / `mark_payout_paid` / `mark_payout_failed`.
- Produces (Task 7's client components call these):
  - `POST /api/admin/payout-accounts/:id/review` `{ approve: boolean, notes?: string }` → `200 { account }`
  - `POST /api/admin/payout-requests/:id/paid` `{ reference: string }` → `200 { request }` (reference required, non-empty)
  - `POST /api/admin/payout-requests/:id/failed` `{ reason: string }` → `200 { request }` (reason required, non-empty; passed to the RPC as `p_notes`)

- [ ] **Step 1: Write the account-review route** (same shape as Task 3):

```ts
// src/app/api/admin/payout-accounts/[id]/review/route.ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutAccountReviewed } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { approve?: boolean; notes?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (typeof body.approve !== 'boolean') {
    return NextResponse.json({ error: 'approve (boolean) is required.' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null

  const admin = createAdminClient()
  const { data: account, error } = await admin.rpc('review_payout_account', {
    p_account_id: id,
    p_approve: body.approve,
    p_notes: notes,
  })
  if (error || !account) {
    return NextResponse.json({ error: error?.message ?? 'Review failed.' }, { status: 400 })
  }

  notifyPayoutAccountReviewed(account.user_id, body.approve, notes).catch((e) =>
    console.error('[email] notifyPayoutAccountReviewed failed', e)
  )

  return NextResponse.json({ account })
}
```

- [ ] **Step 2: Write the mark-paid route:**

```ts
// src/app/api/admin/payout-requests/[id]/paid/route.ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutPaid } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reference?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  if (!reference) {
    return NextResponse.json({ error: 'reference is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: request, error } = await admin.rpc('mark_payout_paid', {
    p_request_id: id,
    p_reference: reference,
  })
  if (error || !request) {
    return NextResponse.json({ error: error?.message ?? 'Mark paid failed.' }, { status: 400 })
  }

  notifyPayoutPaid(request.host_id, request.amount, reference).catch((e) =>
    console.error('[email] notifyPayoutPaid failed', e)
  )

  return NextResponse.json({ request })
}
```

- [ ] **Step 3: Write the mark-failed route:**

```ts
// src/app/api/admin/payout-requests/[id]/failed/route.ts
import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutFailed } from '@/lib/email'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi()
  if (gate instanceof NextResponse) return gate
  const { id } = await params

  let body: { reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: request, error } = await admin.rpc('mark_payout_failed', {
    p_request_id: id,
    p_notes: reason,
  })
  if (error || !request) {
    return NextResponse.json({ error: error?.message ?? 'Mark failed failed.' }, { status: 400 })
  }

  notifyPayoutFailed(request.host_id, request.amount, reason).catch((e) =>
    console.error('[email] notifyPayoutFailed failed', e)
  )

  return NextResponse.json({ request })
}
```

- [ ] **Step 4: Verify live** (same cookie setup as Task 3): for each of the three routes — non-admin renter cookie → **404**; admin host cookie with a random UUID and a valid body → **400** with the RPC's "not found" message; admin cookie with missing `reference`/`reason` → **400** with the validation message.

- [ ] **Step 5: Verify build** — `npm run build` and `npm run lint` clean.

- [ ] **Step 6: Commit** — `git add src/app/api/admin/payout-accounts src/app/api/admin/payout-requests && git commit -m "Add admin payout API routes (account review, mark paid/failed)"`

---

### Task 5: Admin layout + overview page

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `requireAdminPage()` (Task 1), `createAdminClient()`.
- Produces: the `/admin` shell (header + nav linking `/admin`, `/admin/verifications`, `/admin/payouts`) that Tasks 6–7 render inside.

- [ ] **Step 1: Write the layout** (the layout is the page-side auth gate — every `/admin/*` page renders inside it):

```tsx
// src/app/admin/layout.tsx
import Link from 'next/link'
import { requireAdminPage } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage()

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="bg-[#003049] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-lg font-bold">
              Rentivo Admin
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/admin" className="hover:underline">Overview</Link>
              <Link href="/admin/verifications" className="hover:underline">Verifications</Link>
              <Link href="/admin/payouts" className="hover:underline">Payouts</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-xs text-white/70">
            <span>{user.email}</span>
            <Link href="/" className="hover:underline">← Back to site</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Write the overview page:**

```tsx
// src/app/admin/page.tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function pendingCount(table: string) {
  const admin = createAdminClient()
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  return count ?? 0
}

export default async function AdminOverviewPage() {
  const [verifications, payoutAccounts, payoutRequests] = await Promise.all([
    pendingCount('verification_requests'),
    pendingCount('payout_accounts'),
    pendingCount('payout_requests'),
  ])

  const cards = [
    { label: 'Pending identity verifications', count: verifications, href: '/admin/verifications' },
    { label: 'Payout accounts awaiting review', count: payoutAccounts, href: '/admin/payouts' },
    { label: 'Pending payout requests', count: payoutRequests, href: '/admin/payouts' },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-3xl font-bold text-[#003049]">{c.count}</p>
            <p className="mt-1 text-sm text-gray-500">{c.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify live:** admin host cookie → `GET /admin` renders the overview with real counts (200); renter cookie → **404**; signed out → login redirect. In a browser as the demo host, confirm the three cards render and links navigate (Verifications/Payouts will 404 until Tasks 6–7 — expected).

- [ ] **Step 4: Verify build** — `npm run build` and `npm run lint` clean.

- [ ] **Step 5: Commit** — `git add src/app/admin && git commit -m "Add admin layout and overview page"`

---

### Task 6: Verifications queue page

**Files:**
- Create: `src/app/admin/verifications/page.tsx`
- Create: `src/components/admin/VerificationReviewActions.tsx`

**Interfaces:**
- Consumes: `createAdminClient()`, `POST /api/admin/verifications/:id/review` (Task 3), renders inside Task 5's layout (which owns the auth gate; the page itself needs no second guard because it cannot render outside the layout).
- Produces: `/admin/verifications?status=pending|approved|rejected|all` (default `pending`).

- [ ] **Step 1: Write the page** (server component; docs via batch signed URLs, 600s):

```tsx
// src/app/admin/verifications/page.tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { VerificationReviewActions } from '@/components/admin/VerificationReviewActions'

export const dynamic = 'force-dynamic'

interface VerificationRow {
  id: string
  user_id: string
  id_doc_path: string
  selfie_path: string
  status: 'pending' | 'approved' | 'rejected'
  reviewer_notes: string | null
  created_at: string
  reviewed_at: string | null
  profiles: { full_name: string; is_host: boolean; is_verified: boolean; created_at: string } | null
}

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const

export default async function AdminVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: rawStatus } = await searchParams
  const status = FILTERS.includes(rawStatus as (typeof FILTERS)[number])
    ? (rawStatus as (typeof FILTERS)[number])
    : 'pending'

  const admin = createAdminClient()
  let query = admin
    .from('verification_requests')
    .select(
      'id, user_id, id_doc_path, selfie_path, status, reviewer_notes, created_at, reviewed_at, profiles!verification_requests_user_id_fkey(full_name, is_host, is_verified, created_at)'
    )
    .order('created_at', { ascending: false })
    .limit(50)
  if (status !== 'all') query = query.eq('status', status)
  const { data } = await query
  const requests = (data ?? []) as unknown as VerificationRow[]

  // One signed-URL batch for every document on the page (10 min expiry).
  const paths = requests.flatMap((r) => [r.id_doc_path, r.selfie_path])
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await admin.storage.from('verification-docs').createSignedUrls(paths, 600)
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Identity Verifications</h1>
      <div className="mb-6 flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/verifications?status=${f}`}
            className={`rounded-full px-4 py-1.5 text-sm capitalize ${
              f === status ? 'bg-[#003049] text-white' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      {requests.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          No {status === 'all' ? '' : status} verification requests.
        </p>
      )}

      <div className="space-y-6">
        {requests.map((r) => (
          <div key={r.id} className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-900">{r.profiles?.full_name || 'Unknown user'}</p>
                <p className="text-xs text-gray-500">
                  {r.profiles?.is_host ? 'Host' : 'Renter'} · joined{' '}
                  {r.profiles ? new Date(r.profiles.created_at).toLocaleDateString('en-PH') : '—'} ·
                  submitted {new Date(r.created_at).toLocaleDateString('en-PH')}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                  r.status === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : r.status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                }`}
              >
                {r.status}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['ID Document', r.id_doc_path],
                  ['Selfie', r.selfie_path],
                ] as const
              ).map(([label, path]) => (
                <div key={label}>
                  <p className="mb-1 text-xs font-semibold text-gray-500">{label}</p>
                  {urlByPath.get(path) ? (
                    // Signed Supabase-storage URL; plain <img> matches how private
                    // signed content is rendered elsewhere (QR images), bypassing
                    // next/image remotePatterns.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urlByPath.get(path)}
                      alt={label}
                      className="max-h-96 w-full rounded-xl border border-gray-100 object-contain"
                    />
                  ) : (
                    <p className="rounded-xl bg-gray-50 p-4 text-xs text-gray-400">
                      Document unavailable.
                    </p>
                  )}
                </div>
              ))}
            </div>

            {r.reviewer_notes && (
              <p className="mt-4 text-xs text-gray-500">Notes: {r.reviewer_notes}</p>
            )}
            {r.status === 'pending' && <VerificationReviewActions requestId={r.id} />}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the client actions component:**

```tsx
// src/components/admin/VerificationReviewActions.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function VerificationReviewActions({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function review(approve: boolean) {
    if (!approve && !confirm('Reject this verification request?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/verifications/${requestId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, notes: notes || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Review failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Reviewer notes (optional — included in a rejection email)"
        rows={2}
        className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => review(true)}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button
          onClick={() => review(false)}
          disabled={busy}
          className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify live in a browser** as the demo host (local admin): if no pending request exists, create one first — sign in as the demo renter, submit the Settings → VerificationCard with two small test images. Then on `/admin/verifications`: both documents render (signed URLs), filters switch lists, Approve on a test request flips it out of the pending queue and `profiles.is_verified` becomes `true` for the submitter (check via a service-role query), Reject on a second submission stores notes. Confirm the email attempt logged (`[email] …` line or a real send).

- [ ] **Step 4: Verify build** — `npm run build` and `npm run lint` clean.

- [ ] **Step 5: Commit** — `git add src/app/admin/verifications src/components/admin/VerificationReviewActions.tsx && git commit -m "Add admin identity-verification review queue"`

---

### Task 7: Payouts admin page

**Files:**
- Create: `src/app/admin/payouts/page.tsx`
- Create: `src/components/admin/PayoutAccountReviewActions.tsx`
- Create: `src/components/admin/PayoutRequestActions.tsx`

**Interfaces:**
- Consumes: `createAdminClient()`, Task 4's three routes, Task 5's layout (auth gate).
- Produces: `/admin/payouts` — pending payout accounts section, pending payout requests (with itemized bookings), settled-request history.

- [ ] **Step 1: Write the page:**

```tsx
// src/app/admin/payouts/page.tsx
import { createAdminClient } from '@/lib/supabase/admin'
import { PayoutAccountReviewActions } from '@/components/admin/PayoutAccountReviewActions'
import { PayoutRequestActions } from '@/components/admin/PayoutRequestActions'

export const dynamic = 'force-dynamic'

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`

interface AccountRow {
  id: string
  user_id: string
  method: string
  account_number: string
  account_name: string
  status: string
  created_at: string
  profiles: { full_name: string } | null
}

interface RequestRow {
  id: string
  host_id: string
  amount: number
  status: 'pending' | 'paid' | 'failed'
  reference: string | null
  notes: string | null
  requested_at: string
  processed_at: string | null
  profiles: { full_name: string } | null
  payout_accounts: { method: string; account_number: string; account_name: string } | null
  payout_items: { booking_id: string; amount: number }[]
}

export default async function AdminPayoutsPage() {
  const admin = createAdminClient()
  const [{ data: accountsData }, { data: requestsData }] = await Promise.all([
    admin
      .from('payout_accounts')
      .select(
        'id, user_id, method, account_number, account_name, status, created_at, profiles!payout_accounts_user_id_fkey(full_name)'
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    admin
      .from('payout_requests')
      .select(
        'id, host_id, amount, status, reference, notes, requested_at, processed_at, profiles!payout_requests_host_id_fkey(full_name), payout_accounts!payout_requests_payout_account_id_fkey(method, account_number, account_name), payout_items(booking_id, amount)'
      )
      .order('requested_at', { ascending: false })
      .limit(50),
  ])
  const accounts = (accountsData ?? []) as unknown as AccountRow[]
  const requests = (requestsData ?? []) as unknown as RequestRow[]
  const pending = requests.filter((r) => r.status === 'pending')
  const settled = requests.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-4 text-2xl font-bold text-gray-900">Payout Accounts Awaiting Review</h1>
        {accounts.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No payout accounts awaiting review.
          </p>
        )}
        <div className="space-y-4">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <p className="font-semibold text-gray-900">{a.profiles?.full_name || 'Unknown host'}</p>
              <p className="mt-1 text-sm text-gray-600">
                {a.method} · {a.account_name} · {a.account_number}
              </p>
              <p className="text-xs text-gray-400">
                Submitted {new Date(a.created_at).toLocaleDateString('en-PH')}
              </p>
              <PayoutAccountReviewActions accountId={a.id} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Pending Payout Requests</h2>
        {pending.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No pending payout requests.
          </p>
        )}
        <div className="space-y-4">
          {pending.map((r) => (
            <div key={r.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{r.profiles?.full_name || 'Unknown host'}</p>
                  <p className="text-sm text-gray-600">
                    {r.payout_accounts
                      ? `${r.payout_accounts.method} · ${r.payout_accounts.account_name} · ${r.payout_accounts.account_number}`
                      : 'Account unavailable'}
                  </p>
                  <p className="text-xs text-gray-400">
                    Requested {new Date(r.requested_at).toLocaleDateString('en-PH')}
                  </p>
                </div>
                <p className="text-2xl font-bold text-[#003049]">{peso(r.amount)}</p>
              </div>
              <details className="mt-3 text-sm text-gray-600">
                <summary className="cursor-pointer text-xs font-semibold text-gray-500">
                  {r.payout_items.length} booking{r.payout_items.length === 1 ? '' : 's'} covered
                </summary>
                <ul className="mt-2 space-y-1">
                  {r.payout_items.map((i) => (
                    <li key={i.booking_id} className="font-mono text-xs">
                      {i.booking_id} — {peso(i.amount)}
                    </li>
                  ))}
                </ul>
              </details>
              <PayoutRequestActions requestId={r.id} amount={peso(r.amount)} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold text-gray-900">History</h2>
        {settled.length === 0 && (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No settled payout requests yet.
          </p>
        )}
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          {settled.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reference / Reason</th>
                  <th className="px-4 py-3">Processed</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="px-4 py-3">{r.profiles?.full_name || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{peso(r.amount)}</td>
                    <td className="px-4 py-3 capitalize">{r.status}</td>
                    <td className="px-4 py-3 text-xs">{r.reference || r.notes || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.processed_at ? new Date(r.processed_at).toLocaleDateString('en-PH') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Write the account-review client component:**

```tsx
// src/components/admin/PayoutAccountReviewActions.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PayoutAccountReviewActions({ accountId }: { accountId: string }) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function review(approve: boolean) {
    if (!approve && !confirm('Reject this payout account?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/payout-accounts/${accountId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, notes: notes || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Review failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Reviewer notes (optional)"
        className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => review(true)}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Verify Account'}
        </button>
        <button
          onClick={() => review(false)}
          disabled={busy}
          className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the payout-request actions client component:**

```tsx
// src/components/admin/PayoutRequestActions.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PayoutRequestActions({ requestId, amount }: { requestId: string; amount: string }) {
  const router = useRouter()
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(path: 'paid' | 'failed', body: Record<string, string>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/payout-requests/${requestId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Action failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  function markPaid() {
    if (!reference.trim()) {
      setError('A payment reference is required to mark this paid.')
      return
    }
    if (!confirm(`Mark this ${amount} payout as PAID? Only do this after actually sending the money.`)) return
    post('paid', { reference: reference.trim() })
  }

  function markFailed() {
    if (!reason.trim()) {
      setError('A reason is required to mark this failed.')
      return
    }
    if (!confirm('Mark this payout as FAILED? Its bookings become eligible for a new request.')) return
    post('failed', { reason: reason.trim() })
  }

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Payment reference (required)"
          className="flex-1 rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
        />
        <button
          onClick={markPaid}
          disabled={busy}
          className="rounded-xl bg-[#003049] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Mark Paid'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Failure reason (required)"
          className="flex-1 rounded-xl border border-gray-200 p-3 text-sm focus:border-[#003049] focus:outline-none"
        />
        <button
          onClick={markFailed}
          disabled={busy}
          className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
        >
          Mark Failed
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify live in a browser** as the demo host: `/admin/payouts` renders the three sections (empty states are fine). Seed data if needed with a service-role script: call `set_payout_account` as the demo host (drops its status back to `pending`) so an account appears; verify it via the panel and confirm the status flips + email attempt logs. Full request lifecycle is exercised in Task 8.

- [ ] **Step 5: Verify build** — `npm run build` and `npm run lint` clean.

- [ ] **Step 6: Commit** — `git add src/app/admin/payouts src/components/admin/PayoutAccountReviewActions.tsx src/components/admin/PayoutRequestActions.tsx && git commit -m "Add admin payouts page (account review, request settlement)"`

---

### Task 8: Full live e2e pass, docs, production config

**Files:**
- Modify: `AGENTS.md` (Status → Done entry; repository-map line for `src/app/admin`; env-var table row for `ADMIN_EMAILS`)
- No app-code changes expected (fix-and-recheck if the pass finds bugs).

**Interfaces:**
- Consumes: everything above.
- Produces: verified feature + updated docs + `ADMIN_EMAILS` set in Vercel production.

- [ ] **Step 1: Access-control sweep** (scripted, dev server): for each of `/admin`, `/admin/verifications`, `/admin/payouts` and all four API routes — signed out → login redirect (pages) / 404 (APIs); demo-renter cookie → 404 everywhere; demo-host cookie → 200s. Record the matrix of status codes in the task report.

- [ ] **Step 2: Verification lifecycle e2e** (per Task 6 Step 3, if not already done there): real submission → approve via panel → `profiles.is_verified` true + email attempt; second submission → reject with notes → status `rejected`, notes stored, email attempt.

- [ ] **Step 3: Payout lifecycle e2e**, mirroring the migration-020–022 live pass but panel-driven: as demo host run `set_payout_account` (status → pending) → verify via panel → run `request_payout()` as the host (forged-cookie RPC call) → the request appears on `/admin/payouts` with itemized bookings and the amount matching the sum of eligible `rental_fee`s → Mark Paid with a reference → history row shows paid + reference; also exercise Mark Failed on a second request (re-run `set_payout_account`/`request_payout` after the first is paid will fail with no balance — instead mark the *first* request failed before paying it, confirm its bookings become claimable again by a successful second `request_payout()`, then mark that one paid). Confirm each step's email attempt logs.

- [ ] **Step 4: Regression check** — `npm run build` and `npm run lint` clean; spot-check that a normal signed-in renter still browses home/search/listing normally (middleware change touched every request).

- [ ] **Step 5: Update `AGENTS.md`:** add `admin/` to the repository map (`src/app/admin/  — env-allowlisted admin panel (verification + payout review)`), an `ADMIN_EMAILS` row to the env table ("Admin panel allowlist — owner email only in Vercel; local adds the demo host for e2e"), and a Status → Done entry summarizing the feature, its auth model, and exactly what was/wasn't live-verified.

- [ ] **Step 6: Production config:** `vercel env add ADMIN_EMAILS production` with **only** the owner's email (`jptayco1109@gmail.com` — never the demo accounts), then deploy `vercel deploy --prod --yes`. Verify on production: signed-out `https://rentivo.live/admin` → login redirect; demo-renter session → 404. (Owner can verify their own admin access when they next sign in.)

- [ ] **Step 7: Commit** — `git add AGENTS.md && git commit -m "Document admin panel in AGENTS.md"`
