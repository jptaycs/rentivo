// Drafting and reply triage with Claude. Every call gets the same frozen
// system prompt (facts + house rules) so it caches; the lead-specific part
// goes in the user turn.
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { factsBlock } from './facts.ts'
import type { Lead, Message } from './db.ts'

const MODEL = process.env.OUTREACH_MODEL ?? 'claude-opus-5'
const client = new Anthropic()

const RULES = `
# How to write (from Rentivo's outreach playbook)

You write messages FROM the founder to small camera/phone rental businesses in the Philippines who currently take bookings by hand (Facebook page, Marketplace, IG DMs, Viber, group chats). You are drafting; the founder reviews and sends.

- Personalise the first line every time: their page/business name, the specific gear or city you can see in the lead data. If the data gives you nothing specific, use the city. Never invent details you were not given (no "I saw your post about the A7 IV" unless that gear is in the data).
- Respect what they built. The pitch is "keep your business, drop the admin" — never "you're doing it wrong".
- Short. A DM opener is 2–4 short sentences, under 350 characters. An email opener is under 90 words. No bullet lists in openers. No emojis except at most one in a DM.
- End with exactly ONE easy question (e.g. "Would you be open to listing a couple of your cameras there?"). The goal of a first message is a reply, not a signup.
- At most one link, and only ${'`'}rentivo.live${'`'}. For a DM opener, prefer no link at all.
- Plain, warm, human. No hype words (revolutionary, game-changer, seamless, leverage, unlock). No fake urgency. Never pretend to be a customer.
- Language: first contact in clear, friendly English unless the lead's own text is Tagalog/Taglish, then mirror it. In replies, always mirror the language and formality they used.
- Sign off with the sender name given, "from Rentivo".
- Stay strictly inside the facts. If something they'd want isn't true (insurance, instant payouts), don't mention it; if asked, say plainly it isn't offered.
- If the lead does not look like someone who rents out cameras, smartphones or lenses (e.g. a photo studio that only shoots events, a car rental, a drone-only shop, a camera repair or retail store with no rentals), mark fit "no" and still return a short neutral message.

Follow-ups:
- followup1 (sent ~4 days after no reply): 1–2 sentences, a light bump that adds ONE new useful fact (e.g. renters pay the fee on top, or the host approves every booking), same single question.
- followup2 (last, ~10 days after the first): 1–2 sentences, graceful close — "won't message again, the door's open if you ever want to try it", no question pressure.

Replies to a host who wrote back:
- Answer only what they asked, then stop. If the honest answer is weak (no insurance, payouts aren't instant, we're new), say it plainly FIRST.
- End with one small next step they can do in ten seconds (a link, a yes/no, an offer to help set it up).
- If they say stop / not interested / are hostile: one polite line, no pitch, and set opt_out true.
`.trim()

let systemCache: string | null = null
function system(bps: number | null) {
  systemCache ??= `${factsBlock(bps)}\n\n${RULES}`
  return [{ type: 'text' as const, text: systemCache, cache_control: { type: 'ephemeral' as const } }]
}

const DraftSchema = z.object({
  fit: z.enum(['yes', 'no', 'unsure']),
  fit_reason: z.string().describe('One sentence: why this lead does or does not rent out cameras/phones/lenses.'),
  language: z.enum(['english', 'taglish', 'tagalog']),
  subject: z.string().describe('Email subject line (under 60 chars, lowercase-casual is fine). Empty string for non-email channels.'),
  message: z.string().describe('The message body only. No subject line, no opt-out footer.'),
})
export type Draft = z.infer<typeof DraftSchema>

const TriageSchema = z.object({
  bucket: z.enum(['warm', 'suspicious', 'evaluating', 'comparing', 'stalling', 'closed']),
  opt_out: z.boolean().describe('True if they asked not to be contacted, said not interested, or were hostile.'),
  signed_up: z.boolean().describe('True only if they say they already created an account or listing.'),
  language: z.enum(['english', 'taglish', 'tagalog']),
  question: z.string().describe("Their main question copied word for word from their message, or empty string if they asked none."),
  suggested_reply: z.string().describe('The reply to send, mirroring their language.'),
  note_for_founder: z.string().describe('One line for the founder: anything to check or promise NOT to make before sending.'),
})
export type Triage = z.infer<typeof TriageSchema>

function leadContext(lead: Lead) {
  const pick = (({ name, city, address, website, fb_url, ig_url, tiktok_url, rating, rating_count, notes, channel }) => ({
    name, city, address, website, fb_url, ig_url, tiktok_url, rating, rating_count, notes, channel,
  }))(lead)
  return JSON.stringify(Object.fromEntries(Object.entries(pick).filter(([, v]) => v != null && v !== '')), null, 2)
}

function thread(history: Message[]) {
  if (!history.length) return '(no messages yet)'
  return history
    .filter((m) => m.status !== 'skipped' && m.status !== 'draft')
    .map((m) => `[${m.direction === 'out' ? 'US' : 'THEM'} · ${m.kind} · ${m.sent_at ?? m.created_at}]\n${m.body}`)
    .join('\n\n')
}

async function call<T>(schema: z.ZodType<T>, bps: number | null, user: string): Promise<T> {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    system: system(bps),
    messages: [{ role: 'user', content: user }],
  })
  if (res.stop_reason === 'refusal') throw new Error(`Claude declined: ${res.stop_details?.explanation ?? 'no detail'}`)
  if (!res.parsed_output) throw new Error(`No structured output (stop_reason ${res.stop_reason})`)
  return res.parsed_output as T
}

export function draftMessage(
  lead: Lead,
  kind: 'opener' | 'followup1' | 'followup2',
  history: Message[],
  bps: number | null,
): Promise<Draft> {
  const sender = process.env.OUTREACH_SENDER_NAME ?? 'JP'
  return call(
    DraftSchema,
    bps,
    `Write the ${kind} for this lead.\nChannel: ${lead.channel ?? 'fb'} (email means it goes by email; everything else is a DM the founder pastes by hand).\nSender name: ${sender}\n\nLead data:\n${leadContext(lead)}\n\nConversation so far:\n${thread(history)}`,
  )
}

export function triageReply(lead: Lead, history: Message[], reply: string, bps: number | null): Promise<Triage> {
  const sender = process.env.OUTREACH_SENDER_NAME ?? 'JP'
  return call(
    TriageSchema,
    bps,
    `This host just replied. Triage it and draft our answer.\nSender name: ${sender}\n\nLead data:\n${leadContext(lead)}\n\nConversation so far:\n${thread(history)}\n\nTheir new message:\n"""\n${reply}\n"""`,
  )
}
