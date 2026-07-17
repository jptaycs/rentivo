# Rentivo — Project Guide for Agents

## Project Overview

**Rentivo** is a peer-to-peer marketplace exclusively for camera, smartphone, and lens rentals. It connects equipment owners ("hosts") with renters for photography, videography, travel, content creation, events, and short-term projects. Philippine market: ₱ pricing, GCash/Maya payments, cities like Manila, Cebu, Davao.

The project started from a Claude Design prototype (`Rentivo.html` — still the canonical visual reference) and is now a working full-stack app: Next.js frontend, hosted Supabase backend (auth, database, storage), and PayMongo payments.

| Field   | Value                                              |
|---------|----------------------------------------------------|
| Name    | Rentivo                                            |
| Tagline | Rent Smarter. Create More.                         |
| Mission | The most trusted marketplace for renting cameras, smartphones, and lenses — while letting owners earn passive income from unused gear. |

---

## Tech Stack

- **Next.js 16** (App Router, React 19, `src/proxy.ts` for session-aware route guarding)
- **Tailwind CSS 4** + shadcn/ui-style components, lucide-react icons, framer-motion
- **Supabase** — hosted project `rentivo` (ref `prfizruuqwvteqovuqco`): Postgres, Auth, Storage; `@supabase/ssr` for cookie sessions
- **PayMongo** — payment intents API (GCash, Maya, cards); simulated mode in dev when keys are absent
- **TanStack Query**, **Zustand** available; most data fetching is server components + small client hooks

## Repository Map

```
supabase/migrations/     001 schema · 002 triggers · 003 RLS · 004 hardening · 005 seed
                         006/008 demo accounts · 007 create_booking RPC · 009 payments
                         010 host profiles+review seeds · 011 listing views · 012 notifications
                         013 message read receipts
src/app/(auth)/          login, signup, verify, callback, forgot/reset password
src/app/(main)/          home, search, listings/[id], book, book/complete, hosts/[id],
                         dashboard/* (14 pages, all live-wired), host/new (listing wizard)
src/app/api/             payments/checkout, webhooks/paymongo
src/components/          auth, booking, dashboard, home, host, layout, listings,
                         messages, search, shared, ui
src/hooks/               useUser, useBookings, useMyListings, useProfile, useWishlist,
                         useMyReviews, useReviewedBookings, useNotifications, useThreads,
                         useConversation, useAvailabilityBlocks, useRecentlyViewed
src/lib/                 listings.ts, hosts.ts (server data layers), paymongo.ts (server-only),
                         supabase/{client,server,admin,middleware,config}, mock-data.ts
src/types/index.ts       Listing, Booking, Profile, Message, Review, Notification …
Rentivo.html             bundled prototype — canonical visual reference
```

## Environment & Commands

`.env.local` (gitignored) holds all keys; commented placeholders document each one.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Hosted Supabase (publishable key) |
| `SUPABASE_SECRET_KEY` | Service-role writes (payment confirmation) — **set, server-only** |
| `PAYMONGO_SECRET_KEY` / `NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY` | Real PayMongo charges — **set (test mode)**, verified live: real card charge + real GCash redirect against PayMongo's API |
| `PAYMONGO_WEBHOOK_SECRET` | Webhook signature verification — **not yet set** (needs a public URL; `/book/complete` covers dev without it) |
| `RESEND_API_KEY` | Transactional emails — **set**, verified working, but sandbox sender can only reach the account owner's own inbox until a domain is verified at resend.com/domains |
| `EMAIL_FROM` | Optional override, defaults to the Resend sandbox sender |
| `NEXT_PUBLIC_APP_URL` | Redirect return URLs (`http://localhost:3000` in dev) |

- `npm run dev` / `npm run build` / `npm run lint`
- `supabase db push --linked --yes` applies migrations to the hosted project (CLI already linked; ignore pg-delta cert noise after "Applying migration…" — confirm with `supabase migration list --linked`)
- Everything degrades to mock data (`src/lib/mock-data.ts`) when `.env.local` is absent — keep that pattern (`isSupabaseConfigured()`)
- Hosted Postgres: use `gen_random_uuid()` (no `uuid_generate_v4` in search_path); new tables need explicit Data API grants (see 004) or requests 403

**Demo accounts** (pre-confirmed, for e2e tests): host `demo@demo.rentivo.ph`, renter `renter@demo.rentivo.ph`, both password `DemoRentivo1`. Booking your own listing is blocked, so use the renter account to test checkout against seeded listings.

## Architecture Notes

- **Auth**: Supabase cookie sessions via `@supabase/ssr`; `src/proxy.ts` guards `/dashboard`, `/host`, `/book`, `/messages`. Signup enforces password policy client + server; hosted project requires email confirmation.
- **Data layer**: server components call `src/lib/listings.ts`; client pages use hooks (`useBookings`). Host joins use explicit FK hints (`profiles!listings_host_id_fkey`).
- **Booking lifecycle**: `create_booking` RPC is the *only* insert path (direct inserts revoked). It computes all amounts server-side (12% service, 5% protection, promo discount on rental fee only) and creates the booking `pending` + `unpaid`. `mark_booking_paid` (service-role only, idempotent) is the only path to `paid`; Instant Book flips to `confirmed`, which triggers availability blocking. Renters may cancel only pending bookings; host transitions are trigger-enforced (`pending→confirmed→active→completed`).
- **Payments**: `POST /api/payments/checkout` creates/reuses the booking, creates a PayMongo intent for the server-computed total, attaches the payment method (cards tokenized in-browser with the public key — card data never touches our server; e-wallets server-side), and returns `paid` or a redirect URL. `/book/complete` verifies the intent after GCash/Maya/3DS redirects; `POST /api/webhooks/paymongo` (`payment.paid`, HMAC-verified) is the production source of truth. No PayMongo keys → simulated payments (dev only, still requires `SUPABASE_SECRET_KEY`). **Card payment methods must include `billing.email`** (PayMongo API requirement discovered live — 400s without it); the card form auto-fills it from the signed-in user's account email rather than asking for it again.
- **Notifications**: written *only* by security-definer triggers on `bookings` (request/confirmed/cancelled/completed/paid) and `reviews` (received) — never inserted by clients, so RLS only needs to scope reads and `is_read` updates to the owning user. `useNotifications` subscribes via Realtime; powers the navbar bell badge and the dashboard page.
- **Messaging**: threads are derived from bookings the signed-in user is party to (`useThreads`), not a separate conversations table — a thread is a booking with ≥1 message. `useConversation` subscribes per-booking via Realtime and auto-marks incoming messages read while open. "Message Host"/"Message" CTAs deep-link to `/dashboard/messages?booking=<id>`.
- **Analytics**: `listings.view_count` increments via the `increment_listing_view` RPC (security definer, callable by anon+authenticated) called from `ViewTracker` on the listing detail page — a plain counter, not a deduped events log.
- **Transactional email** (`src/lib/email.ts`, Resend): `notifyBookingPaid()` fires from all three places a booking can become paid (checkout route's simulated + real-charge branches, `/book/complete`'s redirect-verification, and the webhook — each guarded so it only fires on the actual unpaid→paid transition) and sends the host a "new request/instant booking" email plus the renter a "confirmed" or "payment received, awaiting host" email depending on `is_instant_book`. `notifyBookingResponded()` fires from the new `POST /api/bookings/[id]/respond` route (host accept/decline now goes through this route instead of a direct client-side table update, so a server context exists to send from) and emails the renter confirmed/declined. No `RESEND_API_KEY` → each call no-ops with a console log instead of failing; verified live by checking those log lines against triggered flows.
- **Security model** (004, extended in 012/013): explicit per-table grants, column-level protection (no self-granting `is_verified`, immutable booking amounts), promo codes readable only via `validate_promo_code()` RPC, storage buckets with mime/size limits and `<uid>/…` folder-scoped writes, security headers in `next.config.ts`, `safeRedirectPath()` on all `?next=` redirects.

---

## Status — Done

- [x] Full frontend: 32 routes, pixel-matched to `Rentivo.html` (homepage, search + filters, listing detail, booking wizard, host wizard, both dashboards, messaging UI, auth pages)
- [x] Brand pass: primary `#003049`, accent `#FDF0D5`, logo/favicon
- [x] Supabase auth end-to-end (signup/login/verify/reset, session navbar, route guards)
- [x] Database schema, triggers, RLS + security hardening (migrations 001–004)
- [x] Hosted Supabase live with seed data: 16 hosts, 16 listings, 3 bundles (005)
- [x] Listings read path: home, search, detail from live DB with mock fallback
- [x] Host listing wizard: photo upload to Storage, listing + availability insert (63f2a3e)
- [x] Booking flow with server-side pricing via `create_booking` RPC (154e9dd)
- [x] Renter/host booking dashboards (`useBookings`) with Accept/Decline
- [x] PayMongo integration (8a4cb1d, 0f1d610): checkout + webhook routes, card tokenization, `/book/complete`, promo codes server-side — **verified with real test-mode keys**: a real card charge (succeeded, amount-checked directly against PayMongo's API) and a real GCash authorization redirect (reachable URL). Falls back to simulated mode when keys are absent.
- [x] Wishlist wired to the `wishlist` table with guest→account heart migration on sign-in (2a77550)
- [x] Host public profiles (`/hosts/[id]`) + review submission/display on completed bookings, both directions (cb2b9d0)
- [x] Host + renter dashboards fully live: Overview, My Listings (pause/activate/delete), Calendar (real availability_blocks), Earnings (+CSV export), Analytics (real view counts via `increment_listing_view`), Receipts, Reviews, Settings (profile/avatar/password) (6f20fe1)
- [x] In-app notifications: `notifications` table + security-definer triggers on booking/review lifecycle, Realtime-subscribed, navbar bell badge (1092e9e)
- [x] Realtime messaging: threads derived from bookings, per-conversation Realtime subscriptions, read receipts (3d235e3)
- [x] Transactional email via Resend: booking request/confirmed/declined/instant/payment-received, free tier, no-ops cleanly without a key
- [x] Demo accounts + repeatable e2e smoke-test pattern (scripts in scratchpad history)

## To Do

**Payments — production hardening (test mode fully verified)**
- [ ] Switch to live PayMongo keys when ready to accept real money (test keys are in use now — never commit live keys)
- [ ] Deploy (Vercel), register webhook URL, set `PAYMONGO_WEBHOOK_SECRET`
- [ ] Refund path: host decline / renter cancel after payment → PayMongo refund + `payment_status='refunded'` (the decline email currently promises a refund that isn't automated yet)

**Email — reaches only your own inbox until this is done**
- [ ] Verify a domain at resend.com/domains and point `EMAIL_FROM` at it — real users (and the demo accounts) get a 403 from Resend's sandbox sender until then

**Deferred — needs a product decision, not just wiring**
- [ ] Payout accounts/history (dashboard/payouts is still mock — no schema for storing bank/e-wallet payout methods; this touches real money movement so needs a deliberate design, not a quick migration)
- [ ] Self-service account deletion (Settings currently routes to "contact support" instead of a destructive self-serve delete, since it needs a service-role cascade across listings/bookings/reviews)
- [ ] Identity verification upload (`verification-docs` bucket ready) → `is_verified` badge flow
- [ ] Image attachments in messages (`messages.image_url` column exists, no upload UI yet)

**Polish / later**
- [ ] Recently-viewed persistence for logged-in users (currently localStorage)
- [ ] Weekly/monthly discount pricing in checkout math (fields exist on listings)
- [ ] Search: availability-date filtering, map view
- [ ] Apple Pay / Google Pay — blocked: PayMongo doesn't support them; keep "Coming soon"
- [ ] Notification preferences (Settings toggles are local-only, not persisted)

---

## Design Reference (canonical)

Prototype: `Rentivo.html`. Match it pixel-for-pixel for layout, color, spacing, and hierarchy.

### Color Palette

| Role        | Token      | Hex       |
|-------------|------------|-----------|
| Primary     | `blue-600` | `#003049` |
| Secondary   | `white`    | `#FFFFFF` |
| Accent      | `orange-500` | `#FDF0D5` |
| Success     | `green-500`  | `#22C55E` |
| Background  | `slate-50`   | `#F8FAFC` |
| Text        | `gray-900`   | `#111827` |

### Typography

Inter (or system-ui). Bold oversized headlines, generous line height, minimal interface.

### Equipment Categories (scope boundary — do not add others)

1. Mirrorless Cameras · 2. DSLR Cameras · 3. Cinema Cameras · 4. Smartphones · 5. Camera Lenses · 6. Creator Bundles

### Key UI Contracts

- **Navbar** (sticky): Logo · Cameras / Phones / Lenses / Creator Kits · Become a Host / Messages / Notifications / Avatar. Blue underline on active link.
- **Hero search**: What / Where / When in one pill, Royal Blue button. Headline: *Rent Professional Cameras & Phones From Trusted Owners*.
- **Listing cards**: image, heart, Verified Host badge, name + brand, city, ₱/day, ⭐ rating + count, Instant Book pill. Example: *Sony A7 IV · Manila · ₱2,500/day · ⭐4.98*
- **Listing detail**: gallery, specs table, what's included, daily/weekly/monthly pricing, availability calendar, host profile block, map, rules/deposit/cancellation, sticky Book Now panel.
- **Booking flow**: Dates → Pickup/Delivery → Pricing review (rental + deposit + service + protection = total) → Payment (GCash · Maya · Card · Apple Pay · Google Pay) → Confirmation + digital receipt.
- **Host wizard**: Photos → Details (brand/model/serial/condition/description/accessories) → Pricing (daily/weekly/monthly/deposit) → Availability → Pickup address → Verification → Submit.
- **Dashboards**: host sidebar (Overview, My Listings, Bookings, Calendar, Messages, Earnings, Reviews, Analytics, Payouts, Settings); renter sidebar (Upcoming, History, Wishlist, Messages, Receipts, Reviews, Notifications).
- **Trust & safety surfaced in UI**: ID/selfie verification badges, deposits on listings, protection at checkout, ratings everywhere, Secure Payments seal, Rental Agreement link at checkout.
- **Mobile**: responsive breakpoints; bottom nav `Home · Search · Bookings · Wishlist · Profile`; 44px tap targets; lazy images.

### Design System Rules

- Rounded corners (8–16px cards, full pills), soft multi-layer shadows, ≥24px section padding
- Subtle 150–300ms ease-in-out animations; hover: lift −2px, image scale 1.02, deeper shadow
- Large high-quality equipment photography on white/neutral backgrounds; generous white space

---

## Implementation Notes for Agents

- **Currency**: Philippine Peso, `₱X,XXX/day` format. Ratings like ⭐4.98.
- **No scope creep**: camera gear and smartphones only — no drones, laptops, consoles, vehicles.
- **Primary color class**: `#003049` (used inline as `bg-[#003049]` etc. throughout).
- **Images**: Unsplash/Pexels placeholders in dev; real assets in production.
- **Server-side money**: never trust client-computed amounts — all pricing goes through `create_booking`; payment confirmation only via service role. Keep it that way for refunds/payouts.
- **E2E test pattern**: sign in a demo account via the auth REST API, forge the SSR cookie (`sb-<ref>-auth-token` = `base64-` + base64url(session JSON)), drive the API routes, clean up with the secret key.
- **Commits**: imperative summaries describing the wired feature (see `git log`); the working convention is one commit per wired feature slice.
