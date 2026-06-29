# Rentivo — AI Website Design Prompt & Agent Implementation Guide

## Project Overview

**Rentivo** is a peer-to-peer marketplace exclusively for camera, smartphone, and lens rentals. It connects equipment owners with renters for photography, videography, travel, content creation, events, and short-term projects.

The prototype design lives in `Rentivo.html` — a bundled React app from Claude Design. All implementation work should mirror that prototype pixel-for-pixel in structure, color, spacing, and component hierarchy.

---

## Brand Identity

| Field     | Value                                              |
|-----------|----------------------------------------------------|
| Name      | Rentivo                                            |
| Tagline   | Rent Smarter. Create More.                         |
| Mission   | The most trusted marketplace for renting cameras, smartphones, and lenses — while letting owners earn passive income from unused gear. |

---

## Color Palette

| Role        | Token            | Hex       |
|-------------|------------------|-----------|
| Primary     | `blue-600`       | `#003049` |
| Secondary   | `white`          | `#FFFFFF` |
| Accent      | `orange-500`     | `#FDF0D5` |
| Success     | `green-500`      | `#22C55E` |
| Background  | `slate-50`       | `#F8FAFC` |
| Text        | `gray-900`       | `#111827` |

---

## Typography

- Modern sans-serif (Inter or system-ui)
- Bold, oversized headlines
- Generous line height and letter spacing
- Minimal interface — no decorative type

---

## Equipment Categories (Scope Boundary)

Only these six categories exist in Rentivo. Do not add others.

1. Mirrorless Cameras
2. DSLR Cameras
3. Cinema Cameras
4. Smartphones
5. Camera Lenses
6. Creator Bundles

---

## Pages & Components

### 1. Navigation Bar (Sticky)

```
[Logo: Rentivo]    [Cameras] [Phones] [Lenses] [Creator Kits]    [Become a Host] [Messages] [Notifications] [Avatar]
```

- Sticky on scroll, white background with subtle shadow
- Logo uses camera icon + wordmark in Royal Blue
- Active nav link uses blue underline indicator

---

### 2. Homepage

#### Hero Section

Large centered search bar — three fields in one pill:

| Field       | Placeholder / Options                          |
|-------------|------------------------------------------------|
| What        | "Sony A7 IV, iPhone 16 Pro Max, 24-70mm…"      |
| Where       | City, Province, Nearby                         |
| When        | Pickup Date → Return Date                      |

- Large Royal Blue search button
- Headline below: **Rent Professional Cameras & Phones From Trusted Owners**
- Subheadline: *Find the perfect camera, smartphone, or lens for your next shoot.*

#### Category Icon Cards

Four icon cards in a row:

| Icon | Label        |
|------|--------------|
| 📷   | Cameras      |
| 📱   | Phones       |
| 🔍   | Lenses       |
| 🎥   | Creator Kits |

#### Featured Equipment Cards

Grid of listing cards. Each card:
- Large equipment image
- Heart / Favorite button (top-right)
- Verified Host badge (top-left)
- Equipment Name + Brand
- Location (city)
- Daily Price (₱ format)
- Star rating + review count
- Instant Book badge (orange pill)

Example: **Sony A7 IV · Manila · ₱2,500/day · ⭐4.98**

#### Popular Near You

Horizontal scroll carousel — same card style as Featured.

Examples: Canon EOS R6, Sony FX3, Sony A7C II, iPhone 16 Pro Max, Samsung Galaxy S25 Ultra, Canon RF 70-200mm, Sony GM Lenses

#### Creator Bundles

Bundle cards with kit contents. Example:

> **Vlogging Kit**
> Sony ZV-E10 + Wireless Microphone + Tripod + LED Light
> ₱1,800/day

#### Why Rentivo — 3 Feature Cards

| Card             | Copy                                                     |
|------------------|----------------------------------------------------------|
| Earn Money       | Turn your unused camera gear into passive income.        |
| Affordable Access | Rent premium equipment without buying it.               |
| Trusted Marketplace | Verified users. Secure payments. Equipment protection. Ratings & reviews. |

---

### 3. Search Results Page

**Top:** Persistent search bar (same as hero, compact version)

**Left Sidebar Filters:**
- Equipment Type
- Brand
- Price Range (slider)
- Location
- Availability
- Camera Mount
- Phone Brand
- Instant Book (toggle)
- Verified Hosts (toggle)
- Ratings (star filter)

**Right Grid:** Responsive listing cards (same as Featured cards)

---

### 4. Equipment Detail Page

- Large photo gallery with image slider
- Equipment specifications table
- What's Included / Accessories list
- Pricing: Daily · Weekly (discount) · Monthly (discount)
- Availability Calendar (blocked dates highlighted)
- Host Profile block:
  - Profile photo, name, Verified badge
  - Host rating, response time, years hosting
  - Reviews section
- Pickup location map
- Rental Rules, Damage Protection, Security Deposit, Cancellation Policy sections
- **Sticky "Book Now" panel** on right while scrolling (price summary + CTA)

---

### 5. Booking Flow

Step-by-step modal / page flow:

1. Select Dates
2. Choose Pickup or Delivery
3. Review Pricing:
   - Rental fee
   - Security deposit
   - Service fee
   - Protection fee
   - **Total**
4. Checkout — Payment methods:
   - GCash · Maya · Credit Card · Apple Pay · Google Pay
5. Booking Confirmation + Digital Receipt

---

### 6. Become a Host — Listing Wizard

| Step | Content                                                                 |
|------|-------------------------------------------------------------------------|
| 1    | Upload Photos                                                           |
| 2    | Equipment Details: Brand, Model, Serial Number, Condition, Description, Included Accessories |
| 3    | Rental Pricing: Daily Rate, Weekly Rate, Monthly Rate, Security Deposit |
| 4    | Availability Calendar                                                   |
| 5    | Pickup Address                                                          |
| 6    | Identity Verification → Submit Listing                                  |

---

### 7. Host Dashboard

Sidebar navigation:
- Dashboard Overview
- My Listings
- Bookings
- Calendar
- Messages
- Earnings
- Reviews
- Analytics
- Payout Settings
- Account Settings

---

### 8. Renter Dashboard

Sidebar navigation:
- Upcoming Rentals
- Rental History
- Wishlist
- Messages
- Receipts
- Reviews
- Notifications

---

### 9. Messaging

- Real-time chat interface
- Booking update threads
- Photo sharing support
- Pickup instruction messages
- Push + in-app notifications

---

### 10. Trust & Safety

Features to surface in UI:
- Government ID Verification badge
- Selfie Verification badge
- Verified Host / Verified Renter badges
- Security Deposits displayed on listings
- Equipment Protection option at checkout
- Ratings & Reviews on all profiles
- Fraud Detection (backend, surface as "Secure" in UI)
- Secure Payments seal
- Rental Agreement link at checkout

---

## Mobile Experience

- Fully responsive, breakpoints: mobile / tablet / desktop
- Bottom navigation bar on mobile:

```
[Home]  [Search]  [Bookings]  [Wishlist]  [Profile]
```

- Large touch-friendly buttons (min 44px tap target)
- Optimized image loading (lazy load, next-gen formats)

---

## Design System Rules

- **Corners:** Rounded (8–16px on cards, 24–9999px on pills/badges)
- **Shadows:** Soft, multi-layer (`shadow-sm` to `shadow-lg`)
- **Spacing:** Generous padding — 24px minimum between sections
- **Animations:** Subtle — 150–300ms ease-in-out on hover/focus
- **Hover effects:** Lift cards (translateY -2px), scale images (1.02), deepen shadow
- **Photography:** Always large, high-quality hero images; equipment shots on white/neutral backgrounds
- **White space:** Sections breathe — never packed

---

## Core Feature Checklist

- [x] Equipment search (keyword + category)
- [x] Advanced filtering (sidebar)
- [x] Wishlist / Favorites
- [x] Instant Booking
- [x] Availability Calendar
- [x] Online Payments (GCash, Maya, Card, Apple/Google Pay)
- [x] Verified Hosts & Renters
- [x] Ratings & Reviews
- [x] Secure Messaging
- [x] Booking Management (host + renter dashboards)
- [x] Host Earnings Dashboard
- [x] Push & In-app Notifications
- [x] Promo Codes
- [x] Equipment Protection option
- [x] Rental Agreements
- [ ] Recently Viewed Items
- [x] Featured Listings
- [x] Popular Rentals carousel
- [x] Creator Bundles

---

## Implementation Notes for Agents

- **Prototype source:** `Rentivo.html` — this is the canonical visual reference. When in doubt about layout, color, or spacing, match the prototype.
- **Currency:** Philippine Peso (₱). All prices in ₱/day format.
- **Location context:** Philippines — cities like Manila, Cebu, Davao as default location examples.
- **Ratings:** Use ₱ for currency and ⭐ star ratings (e.g., 4.97, 4.98, 5.0).
- **Do not scope-creep:** No drones, laptops, gaming consoles, vehicles, or other rental categories. Camera gear and smartphones only.
- **Stack assumptions:** React + Tailwind CSS (mirrors prototype). Use `#003049` as the primary Tailwind class (`blue-600`).
- **Images:** Use placeholder equipment images (unsplash/pexels Sony/Canon gear) during development; swap for real assets in production.
- **Fonts:** Inter from Google Fonts or system-ui stack.
