// Cold email through Resend, from a domain that is NOT rentivo.live.
// Booking receipts and payout statements go out from rentivo.live; one spam
// complaint wave from cold outreach on that domain would push those into
// spam folders too. So the sender domain is checked, not just documented.
import { BUSINESS } from './facts.ts'

export function emailConfig() {
  const apiKey = process.env.OUTREACH_RESEND_API_KEY
  const from = process.env.OUTREACH_EMAIL_FROM
  const replyTo = process.env.OUTREACH_REPLY_TO ?? BUSINESS.contact
  const cap = Number(process.env.OUTREACH_DAILY_EMAIL_CAP ?? 30)
  const problems: string[] = []
  if (!apiKey) problems.push('OUTREACH_RESEND_API_KEY is not set')
  if (!from) problems.push('OUTREACH_EMAIL_FROM is not set')
  const domain = from?.match(/@([^>\s]+)/)?.[1]?.toLowerCase()
  // A subdomain (send.rentivo.live) shares the parent's reputation, so it's refused too.
  if (domain === 'rentivo.live' || domain?.endsWith('.rentivo.live')) {
    problems.push(`OUTREACH_EMAIL_FROM uses ${domain}. Use a separate outreach domain so cold email can't hurt booking-email deliverability.`)
  }
  return { apiKey, from, replyTo, cap, problems }
}

export function footer(leadName: string) {
  return [
    '',
    '',
    '—',
    `You're getting this because ${leadName} is listed publicly as a rental business. Reply "stop" and I won't email again.`,
    `${BUSINESS.tradeName} · ${BUSINESS.name} (DTI ${BUSINESS.dti}) · ${BUSINESS.address}`,
  ].join('\n')
}

export async function sendEmail(to: string, subject: string, text: string): Promise<string> {
  const cfg = emailConfig()
  if (cfg.problems.length) throw new Error(cfg.problems.join('; '))
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: cfg.from,
      to: [to],
      reply_to: cfg.replyTo,
      subject,
      text,
      headers: { 'List-Unsubscribe': `<mailto:${cfg.replyTo}?subject=unsubscribe>` },
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
  if (!res.ok || !body.id) throw new Error(`Resend ${res.status}: ${body.message ?? 'unknown error'}`)
  return body.id
}
