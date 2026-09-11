// Proves the legal documents exist, that every surface links somewhere real,
// and that the app states no policy it does not implement.
//
// Also covers the merchant-disclosure set a payment processor's review looks
// for: registration number, business address, terms, privacy, return/refund,
// customer-service contact, dispute resolution.
//
// Usage: node --experimental-strip-types scripts/verify/legal-pages.mjs [appUrl]
import { check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const PAGES = ['/terms', '/privacy', '/refunds', '/disputes', '/contact', '/rental-agreement', '/host-terms']

const BUSINESS_NAME = 'Appnado IT Solutions'
const DTI_NUMBER = '7356023'
const ADDRESS = 'Naga City, Camarines Sur'
const EMAIL = 'appnadoitsolutions@gmail.com'

// Claims the app must no longer make anywhere.
const FORBIDDEN = [
  '48 hours',
  'Flexible, Moderate, or Strict',
  'refundable upon return',
  'collected at checkout',
  'Equipment Protection',
  'accidental damage',
  'support@rentivo.ph',
  // The admin allowlist address is deliberately not a published contact
  // address — customer service is BUSINESS.email. See src/lib/business.ts.
  'jptayco1109@gmail.com',
]

const get = async (p) => {
  const res = await fetch(`${APP}${p}`, { redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location'), html: await res.text() }
}

async function main() {
  for (const p of PAGES) {
    const { status, html } = await get(p)
    check(`${p} returns 200`, status === 200, `HTTP ${status}`)
    check(`${p} names ${BUSINESS_NAME}`, html.includes(BUSINESS_NAME))
    check(`${p} carries the contact address`, html.includes(EMAIL))
  }

  // The old cancellation URL is linked from already-sent receipts and email.
  const cancel = await get('/cancellation')
  check('/cancellation redirects permanently', cancel.status === 308, `HTTP ${cancel.status}`)
  check('/cancellation points at /refunds', cancel.location === '/refunds', String(cancel.location))

  // Registration number and business address must be published, and the
  // footer puts them on every page — so the homepage is the real test.
  const { html: home } = await get('/')
  check('footer publishes the DTI registration number', home.includes(DTI_NUMBER))
  check('footer publishes the business address', home.includes(ADDRESS))
  check('footer publishes the contact address', home.includes(EMAIL))
  for (const href of ['/terms', '/privacy', '/refunds', '/disputes', '/contact']) {
    check(`footer links ${href}`, home.includes(`href="${href}"`))
  }

  // Contact page must carry the full merchant identity, not just an email.
  const { html: contact } = await get('/contact')
  for (const term of [BUSINESS_NAME, DTI_NUMBER, ADDRESS, EMAIL]) {
    check(`/contact states ${term}`, contact.includes(term))
  }

  // The privacy notice must actually mention the sensitive data it collects.
  const { html: privacy } = await get('/privacy')
  for (const term of ['government', 'selfie', 'National Privacy Commission', 'Supabase', 'PayMongo']) {
    check(`/privacy mentions ${term}`, privacy.toLowerCase().includes(term.toLowerCase()))
  }

  // Terms must carry the venue disclaimer and the suspension clause.
  const { html: terms } = await get('/terms')
  check('/terms says Rentivo is not a party to rentals', /not a party/i.test(terms))
  check('/terms carries a suspension clause', /suspend/i.test(terms))

  // Refund policy must describe the real behaviour, not tiers.
  const { html: refunds } = await get('/refunds')
  check('/refunds says refunded in full', /in full/i.test(refunds))
  check('/refunds does NOT describe tiers', !/Flexible/i.test(refunds))
  check('/refunds covers returning the equipment', /Returning the equipment/i.test(refunds))
  check('/refunds states deposits are not held by Rentivo', /does not charge, hold or return/i.test(refunds))

  // Dispute policy must say who decides what, and where to escalate.
  const { html: disputes } = await get('/disputes')
  check('/disputes names the DTI', /Department of Trade and Industry/i.test(disputes))
  check('/disputes names the NPC', /National Privacy Commission/i.test(disputes))
  check('/disputes states what Rentivo cannot do', /cannot/i.test(disputes))

  // No public page may carry a forbidden claim or a dead link.
  const PUBLIC = ['/', '/search', '/login', '/signup', ...PAGES]
  for (const p of PUBLIC) {
    const { html } = await get(p)
    check(`${p} has no href="#"`, !html.includes('href="#"'))
    check(`${p} has no link to the removed /cancellation page`, !html.includes('href="/cancellation"'))
    for (const claim of FORBIDDEN) {
      check(`${p} does not say "${claim}"`, !html.includes(claim))
    }
  }
  done()
}

main()
