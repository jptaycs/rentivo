// Proves the four legal documents exist and that no surface still links to
// nothing or states a policy the code does not implement.
//
// Usage: node --experimental-strip-types scripts/verify/legal-pages.mjs [appUrl]
import { check, done } from './env.mjs'

const APP = process.argv[2] ?? 'http://localhost:3100'
const PAGES = ['/terms', '/privacy', '/rental-agreement', '/cancellation', '/host-terms']

// Claims the app must no longer make anywhere.
const FORBIDDEN = [
  '48 hours',
  'Flexible, Moderate, or Strict',
  'refundable upon return',
  'collected at checkout',
  'Equipment Protection',
  'accidental damage',
  'support@rentivo.ph',
]

const get = async (p) => {
  const res = await fetch(`${APP}${p}`)
  return { status: res.status, html: await res.text() }
}

async function main() {
  for (const p of PAGES) {
    const { status, html } = await get(p)
    check(`${p} returns 200`, status === 200, `HTTP ${status}`)
    check(`${p} names Appnado IT Solutions`, html.includes('Appnado IT Solutions'))
    check(`${p} carries the contact address`, html.includes('jptayco1109@gmail.com'))
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

  // Cancellation must describe the real behaviour, not tiers.
  const { html: cancel } = await get('/cancellation')
  check('/cancellation says refunded in full', /in full/i.test(cancel))
  check('/cancellation does NOT describe tiers', !/Flexible/i.test(cancel))

  // No public page may carry a forbidden claim or a dead link.
  const PUBLIC = ['/', '/search', '/login', '/signup', ...PAGES]
  for (const p of PUBLIC) {
    const { html } = await get(p)
    check(`${p} has no href="#"`, !html.includes('href="#"'))
    for (const claim of FORBIDDEN) {
      check(`${p} does not say "${claim}"`, !html.includes(claim))
    }
  }
  done()
}

main()
