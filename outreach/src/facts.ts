// What a message is allowed to claim. Everything here is checked against the
// live product (AGENTS.md is the record). A host who catches one false claim
// stops believing the rest, so when the product changes, change this file first.

export const BUSINESS = {
  name: 'Appnado IT Solutions',
  tradeName: 'Rentivo',
  dti: '7356023',
  address: 'Naga City, Camarines Sur, Philippines',
  site: 'https://rentivo.live',
  hostSignup: 'https://rentivo.live/host/new',
  contact: 'rentivo02@gmail.com',
}

/** The live platform service fee, read from the same RPC the site uses. null if unreachable. */
export async function liveServiceFeeBps(): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/rpc/current_service_fee_bps`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const bps = (await res.json()) as unknown
    return typeof bps === 'number' ? bps : null
  } catch {
    return null
  }
}

export function feeLine(bps: number | null): string {
  if (bps == null) {
    return 'Renters pay a small platform service fee ON TOP of the host\'s rate. Do not state a percentage (the live rate could not be read).'
  }
  const pct = Number((bps / 100).toFixed(2))
  return `Renters pay a ${pct}% platform service fee ON TOP of the host's rate. Nothing is deducted from the host's earnings — the host receives 100% of the rate they set (plus any delivery fee).`
}

export function factsBlock(bps: number | null): string {
  return `
# About Rentivo (the only facts you may state)

Rentivo (${BUSINESS.site}) is a Philippine peer-to-peer marketplace for renting cameras, smartphones and camera lenses — nothing else (no drones, laptops, consoles, lighting-only, vehicles). Operated by ${BUSINESS.name}, DTI reg. no. ${BUSINESS.dti}, ${BUSINESS.address}. Contact: ${BUSINESS.contact}. It is NEW and small — never imply a big existing renter base.

TRUE — you may say these:
- Free to list. No listing fee, no monthly fee, no subscription.
- ${feeLine(bps)}
- The host sets their own daily rate; optional weekly and monthly rates apply automatically on longer rentals.
- The host approves or declines every booking request. Instant Book is optional and off unless they turn it on.
- Renters pay online through PayMongo before a booking is confirmed, by QR Ph (they scan it with GCash, Maya or any bank app). QR Ph is the only payment method, by choice — never say card, GCash or Maya checkout options are available or coming. No chasing payment screenshots.
- Confirmed bookings block the dates on the host's calendar automatically — no double-booking across chat threads.
- Payouts: after a rental is completed and the gear is returned, Rentivo transfers what the host is owed to their GCash, Maya or bank account and emails a numbered payout statement. The host does NOT need to request it. It is not instant and there is no fixed payout schedule — do not promise one.
- Security deposit: if the host wants one, the HOST collects it in person at pickup. Rentivo does not hold deposits.
- Optional delivery: flat fee, free, or a per-kilometre fee; the delivery fee goes to the host in full.
- Every host verifies once with a government ID and a selfie, reviewed by a person; listings go live after approval.
- The public map shows only an approximate area; the exact pickup point is shown to a renter only after the host confirms their booking.
- Two-way reviews (hosts rate renters too), built-in messaging with photo attachments, digital receipts, earnings dashboard.
- Nationwide: any city or province in the Philippines.
- The founder will personally help them set up their first listing (over chat or a quick call), using the photos they already have.

NEVER say or imply any of these (they are false):
- Insurance, damage protection, a protection plan, or that Rentivo covers loss/damage/theft.
- Guaranteed bookings, a number of renters, or earnings figures.
- Instant or automatic payouts, or a payout schedule.
- That the host can be paid directly to their own GCash/Maya QR (retired).
- That Rentivo holds or refunds security deposits.
- Anything negative about their current way of doing business, or about competitors.
`.trim()
}
