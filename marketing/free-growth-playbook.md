# Free growth playbook

What Rentivo can do for free to get hosts and renters, who does each piece, and how to
tell whether it is working. Written 2026-10-21. Every claim in the copy files next to
this one is checked against `outreach/src/facts.ts`; when the product changes, change
that file first and then these.

## The honest starting point

| Fact (2026-10-21) | Why it matters |
|---|---|
| 22 live listings, **19 are seed data** with hosts who do not exist | A renter who books a seed listing gets no gear. Renter-facing promotion must point at real listings only. |
| 3 real listings, all in **Naga**, one host | Naga is the only city where a renter can actually rent something today. Start there. |
| Outreach: **139 openers drafted, 0 sent** (74 Facebook, 61 Instagram, 4 web) | The single biggest free lever is sitting in `outreach/data/sendlist-map.csv` waiting to be pasted. |
| Promo codes retired (migration 071) | Every discount came out of Rentivo's 5% fee, so each code lost money. No "first booking 10% off". |
| No analytics until this change | Nothing could be measured. Vercel Web Analytics is now in the code; it still has to be switched on (below). |

## Shipped in code (this change)

- `robots.txt` and `sitemap.xml` (every live listing, host and category, plus one search URL per city that has listings).
- Real page titles and descriptions for listing pages and search pages, a photo preview when a listing link is shared, a branded default preview image for every other page.
- Product structured data on listing pages (price per day in PHP, rating when there are reviews), Organization and WebSite data site-wide.
- Vercel Web Analytics (`@vercel/analytics`), the free tier.

## Owner actions, in order of payoff

1. **Send the 139 DMs.** `cd outreach && npm run o -- queue` copies each message and opens the page; you paste and send. Keep to about 25 an hour (the tool warns). Replies: `npm run o -- reply <id>`. Supply is the whole game right now.
2. **Switch on analytics.** Vercel dashboard → project `rentivo` → Analytics → Enable. Nothing is recorded until that click.
3. **Google Search Console.** Add `https://rentivo.live` (URL-prefix). Verify by DNS TXT on the domain registrar, or send me the HTML-tag token and I will add it. Then submit `https://rentivo.live/sitemap.xml`. Do the same at Bing Webmaster Tools (it can import from Search Console).
4. **Google Business Profile** for Appnado IT Solutions / Rentivo in Naga City. Free, and "camera rental naga" searches show the map pack first.
5. **Post in renter groups**, Naga first, using `renter-posts.md`. One post per group per week, always a real listing link, reply to every comment.
6. **List the real gear on Facebook Marketplace and Carousell** with the template in `renter-posts.md`, linking back to the Rentivo listing. That is where Filipinos search "camera rent" today.
7. **Three short videos a week** on TikTok and Reels from `tiktok-reels-scripts.md`. Reuse `host-promo-video.html` and the caption already in this folder for the host side.
8. **Partnerships** from `partnership-emails.md`: Ateneo de Naga and UNC media orgs, Naga wedding coordinators, camera shops. One referring partner beats a month of posting.

## Facebook groups and pages to search for

Search these phrases on Facebook and join the active ones (members posting this week). Do not post the same text in all of them in one hour; Facebook rate-limits that as spam.

- `camera rental Naga`, `camera for rent Bicol`, `Naga photographers`, `Bicol videographers`
- `camera rental Philippines`, `camera for rent Manila`, `photography Philippines buy and sell`
- `wedding suppliers Naga`, `wedding suppliers Bicol`, `event suppliers Camarines Sur`
- `content creators Philippines`, `vloggers PH`, `TikTok creators Philippines`

## How to know it is working

Check weekly, in this order, and write the numbers down:

| Signal | Where |
|---|---|
| Visitors, top pages, referrers | Vercel Analytics |
| Impressions and clicks per query | Search Console (takes 2–4 weeks to show data) |
| Outreach funnel: contacted → replied → listed | `npm run o -- stats` |
| New real listings, inquiries, bookings | `/admin/reports` |

If a channel sends visitors but no inquiries, the listing pages are the problem. If it sends nothing, the channel is.

## Not done, on purpose

- **City landing pages** ("camera rental Cebu"). With 3 real listings they would be thin pages built on seed data. Build them once two or more cities have five or more real listings each.
- **Referral credits or a fee waiver.** Both need booking-side code and a way to fund them. Revisit when there are bookings to refer.
- **Paid ads.** Not free. When ready, ₱3,000–5,000 of Facebook ads to one city, sent to one listing page, measured in Analytics.
