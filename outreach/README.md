# Rentivo host outreach

A local CLI that finds camera/phone rental businesses, drafts personal openers with Claude, sends email automatically, queues DMs for you to paste, schedules follow-ups, and triages replies. It's separate from the app: it has its own `package.json`, and the root `tsconfig.json`/ESLint config exclude it.

**Leads are personal data.** They live in `data/leads.db` on this machine only (gitignored), never in Rentivo's Supabase project.

## Setup

```bash
cd outreach
npm install
cp .env.example .env    # fill it in
```

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | `draft`, `followups`, `reply` (or run `ant auth login` instead) |
| `GOOGLE_PLACES_API_KEY` | Optional, only for `find`. Enable **Places API (New)** in Google Cloud. |
| `OUTREACH_RESEND_API_KEY`, `OUTREACH_EMAIL_FROM` | `email --live`. **Use a separate domain**, e.g. `hello.getrentivo.com`, verified in Resend. The tool refuses to send from `rentivo.live` or any subdomain of it, because cold-email complaints would push booking receipts and payout statements into spam. |
| `OUTREACH_REPLY_TO` | Where replies land. Defaults to the public support address. |
| `OUTREACH_DAILY_EMAIL_CAP` | Defaults to 30. Warm a new domain up slowly (for example 10/day in week 1, 20 in week 2, then 30–50). |

`../.env.local` is loaded too, so every draft uses the **live** service-fee rate from `current_service_fee_bps()`. Messages never quote a stale percentage.

## Where leads come from

Most PH camera and phone rental hosts run from a Facebook page, Instagram or TikTok with no storefront, so Google Maps misses them. Find them the way renters do: search "camera rental <city>" / "iPhone rental <city>" on Google, Facebook, Instagram (#camerarentalph) and TikTok, then paste the page URLs. Groups and Marketplace links are skipped (you can't DM a group). The tool doesn't scrape Facebook or Instagram: that breaks Meta's terms and risks your account.

## Daily loop

```bash
npm run o -- paste --city "Quezon City"                 # page URLs from the clipboard, one per line:
                                                        #   https://facebook.com/somepage
                                                        #   Name | https://instagram.com/handle | rents A7IV, FX3
npm run o -- add --name "Lens Lab PH" --fb https://facebook.com/lenslab.ph --city Naga
npm run o -- import pages.csv                           # a bigger list as CSV
npm run o -- find --city Cebu --query "phone rental"    # optional: Google Maps, only finds shops with a storefront
npm run o -- enrich                                     # website → email + social links
npm run o -- draft --limit 20                           # Claude writes openers, screens out non-fits
npm run o -- email                                      # dry run: read what would go out
npm run o -- email --live                               # send, capped per day, with a jitter between sends
npm run o -- queue                                      # DMs: copies the text, opens the page; you paste + send
npm run o -- followups                                  # closes leads that never replied (no follow-ups are sent)
npm run o -- reply 12                                   # paste their reply → bucket + drafted answer (copied)
npm run o -- set 12 signed_up                           # later: listed
npm run o -- stats                                      # funnel, reply rate by channel
npm run o -- questions                                  # every question hosts asked, word for word
```

## What is automated and what isn't, and why

- **Email is sent automatically.** Every email includes a "reply stop" line, the operator's identity, a `List-Unsubscribe` header, a daily cap, and random spacing between sends.
- **Facebook/Instagram/TikTok DMs are not sent automatically.** Bots break Meta's rules and get the page restricted. `queue` does everything except the paste: it copies the message, opens the page, and records what you sent. It also warns after 25 DMs in an hour.
- **Every draft is grounded in `src/facts.ts`**, the only claims a message may make. There's no insurance, no instant payouts, no host QR, and Rentivo holds no deposits. **When the product changes, update that file first.**
- **Replies are drafted, never auto-sent.** You read every answer before it goes out.
- **Do-not-contact is permanent.** `dnc`, the "x" key in `queue`, or a reply Claude classifies as an opt-out adds every identifier the lead has (email, page URLs, phone, Google place id) to the `dnc` table. A later `find`/`add`/`import` skips that business, even under a different name.
- **One message per host.** Follow-ups are off (`OUTREACH_MAX_FOLLOWUPS=0`, the owner's rule since 2026-09-24): `followups` only closes leads that haven't replied after 14 days. Setting it to 1 or 2 re-enables the day-4 / day-10 follow-ups. Replies from hosts are still answered; that isn't outreach.

## Notes

- Model: `claude-opus-5` with server-side refusal fallbacks enabled. Override with `OUTREACH_MODEL`.
- The SDK moves `enum` constraints into field descriptions when it builds the output schema. The model still sees the allowed values, and zod validates the parsed result.
- Typecheck with `npm run typecheck`. Node 22.5+ is required (`node:sqlite`, native `.ts`).
