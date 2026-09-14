// Security audit 2, MEDIUM-1: every email template must escape user- and
// host-authored values. Runs against the REAL template module:
//   node --experimental-strip-types scripts/verify/audit2-email-escaping.mjs
import * as t from '../../src/lib/email-templates.ts'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS ${name}`) } else { fail++; console.log(`FAIL ${name} ${detail}`) }
}

const HOSTILE = [
  '<script>alert(1)</script>',
  '<a href="https://evil.example.com">Verify your payment</a>',
  '"><img src=x onerror=alert(1)>',
  "'><svg onload=alert(1)>",
]
const BENIGN = 'Plain Value'
// Raw markup that would only appear if an input escaped its text context:
// a tag opener from the payload, or a quote that breaks out of an attribute.
// (The words "onerror=alert" legitimately remain as inert, escaped TEXT.)
// The '<' and '"' count comparisons below are the strict check; these markers
// just make a failure readable.
const RAW_MARKERS = ['<script', '<a href="https://evil', '<img', '<svg', '"><', "'><"]

const ltCount = (s) => (s.match(/</g) ?? []).length
const qCount = (s) => (s.match(/["']/g) ?? []).length

function ctx(v) {
  return {
    bookingRef: v,
    listingTitle: v,
    pickupDate: '2026-09-20',
    returnDate: '2026-09-22',
    totalAmount: 2490,
    otherPartyName: v,
  }
}

const templates = {
  'hostNewBookingHtml(instant)': (v) => t.hostNewBookingHtml(ctx(v), true),
  'hostNewBookingHtml(request)': (v) => t.hostNewBookingHtml(ctx(v), false),
  renterConfirmedHtml: (v) => t.renterConfirmedHtml(ctx(v)),
  renterPendingHtml: (v) => t.renterPendingHtml(ctx(v)),
  'renterDeclinedHtml(refunded)': (v) => t.renterDeclinedHtml(ctx(v), true, false),
  'renterDeclinedHtml(host_qr)': (v) => t.renterDeclinedHtml(ctx(v), false, true),
  'hostCancelledByRenterHtml(refunded)': (v) => t.hostCancelledByRenterHtml(ctx(v), true, false),
  'hostCancelledByRenterHtml(host_qr)': (v) => t.hostCancelledByRenterHtml(ctx(v), false, true),
  newMessageHtml: (v) =>
    t.newMessageHtml({ senderName: v, listingTitle: v, preview: v, conversationId: v }),
  'adminDecisionHtml+notesBlock': (v) =>
    t.adminDecisionHtml({ heading: 'Verification Not Approved', bodyHtml: `<p>x</p>${t.notesBlock(v)}`, ctaPath: '/dashboard/settings', ctaLabel: 'Resubmit' }),
  // Payout statements (082): every host-, admin- or user-authored field hostile
  // at once — listing title and booking ref (host), reference and reversal
  // reason (admin), host name and account label (user-set).
  payoutStatementIssuedHtml: (v) => t.payoutStatementIssuedHtml(statementCtx(v)),
  'payoutStatementReversedHtml(reason)': (v) => t.payoutStatementReversedHtml({ ...statementCtx(v), reversedOn: '2026-09-20T03:00:00Z', reversalReason: v }),
  'payoutStatementReversedHtml(no reason)': (v) => t.payoutStatementReversedHtml({ ...statementCtx(v), reversedOn: '2026-09-20T03:00:00Z' }),
}

function statementCtx(v) {
  const item = (ref) => ({
    bookingRef: `${ref}${v}`, listingTitle: v, pickupDate: '2026-09-01', returnDate: '2026-09-03',
    rentalFee: 2000, deliveryFee: 350, serviceFee: 100, earnings: 2350,
  })
  return {
    hostName: v, statementNumber: 'PS-2026-000001', amount: 4700, transferredOn: '2026-09-15',
    reference: v, accountLabel: `GCash •••• 4567 ${v}`, grossBookingValue: 4900, serviceFeeTotal: 200,
    deliveryFeeTotal: 700, requestId: '00000000-0000-4000-8000-000000000001', items: [item('A'), item('B')],
  }
}

for (const [name, render] of Object.entries(templates)) {
  const benignHtml = render(BENIGN)
  const baseline = ltCount(benignHtml)
  const qBaseline = qCount(benignHtml)
  // A marker counts as leaked only if the hostile render has MORE of it than
  // the benign one — a template's own markup (e.g. `style="…"><strong>`) may
  // legitimately contain the same character sequence.
  const occurrences = (h, m) => h.split(m).length - 1
  for (const payload of HOSTILE) {
    const html = render(payload)
    const leaked = RAW_MARKERS.filter((m) => occurrences(html, m) > occurrences(benignHtml, m))
    check(`${name} :: no raw markup from ${JSON.stringify(payload)}`, leaked.length === 0, `leaked ${leaked.join(', ')}`)
    check(
      `${name} :: '<' count unchanged by ${JSON.stringify(payload)}`,
      ltCount(html) === baseline,
      `benign=${baseline} hostile=${ltCount(html)}`
    )
    check(
      `${name} :: '"' count unchanged by ${JSON.stringify(payload)}`,
      qCount(html) === qBaseline,
      `benign=${qBaseline} hostile=${qCount(html)}`
    )
    check(`${name} :: payload present in escaped form`, html.includes('&lt;') || !payload.includes('<'))
  }
}

// Distance-based delivery (final review I1): the host new-booking email now
// carries the renter-TYPED delivery address. Render it hostile in the address
// field only, everything else benign, and in every shape the email can take.
const deliveryShapes = {
  'per-km instant': (addr) => t.hostNewBookingHtml(ctx(BENIGN), true, { address: addr, distanceKm: 31, fee: 720 }),
  'per-km request': (addr) => t.hostNewBookingHtml(ctx(BENIGN), false, { address: addr, distanceKm: 31, fee: 720 }),
  'flat-fee request': (addr) => t.hostNewBookingHtml(ctx(BENIGN), false, { address: addr, distanceKm: null, fee: 350 }),
}
const DELIVERY_HOSTILE = [
  ...HOSTILE,
  // Line breaks become <br> only AFTER escaping; a payload split across lines
  // must not reassemble into a tag.
  '12 Real St\n<script>alert(1)</script>\r\n"><img src=x onerror=alert(1)>',
  'Null\x00byte <b>bold</b>',
]
for (const [shape, render] of Object.entries(deliveryShapes)) {
  const benign = render(BENIGN)
  check(`delivery ${shape} :: benign address rendered`, benign.includes('Delivery to:') && benign.includes(BENIGN))
  check(`delivery ${shape} :: fee rendered`, benign.includes('Delivery fee: ₱'))
  const benignBr = (benign.match(/<br>/g) ?? []).length
  for (const payload of DELIVERY_HOSTILE) {
    const html = render(payload)
    const leaked = [...RAW_MARKERS, '<b>'].filter((m) => html.split(m).length > benign.split(m).length)
    check(`delivery ${shape} :: no raw markup from ${JSON.stringify(payload)}`, leaked.length === 0, `leaked ${leaked.join(', ')}`)
    const extraBr = (payload.match(/\r\n|\r|\n/g) ?? []).length
    check(
      `delivery ${shape} :: '<' count only grows by the address's own line breaks for ${JSON.stringify(payload)}`,
      ltCount(html) === ltCount(benign) + extraBr && (html.match(/<br>/g) ?? []).length === benignBr + extraBr,
      `benign=${ltCount(benign)} hostile=${ltCount(html)} extraBr=${extraBr}`
    )
    check(`delivery ${shape} :: '"' count unchanged by ${JSON.stringify(payload)}`, qCount(html) === qCount(benign))
    check(`delivery ${shape} :: address present escaped`, html.includes('&lt;script&gt;') || html.includes('&lt;a href=') || html.includes('&quot;&gt;&lt;img') || html.includes('&#39;&gt;&lt;svg') || html.includes('&lt;b&gt;'))
  }
}
const perKm = t.hostNewBookingHtml(ctx(BENIGN), false, { address: '12 Real St', distanceKm: 31, fee: 720 })
check('delivery per-km :: distance shown', perKm.includes('(31 km)'))
check('delivery per-km :: pin-check prompt shown', perKm.includes("renter&#39;s map pin") || perKm.includes("renter's map pin"))
check('delivery per-km :: no coordinates or map link', !/maps\.|lat=|lng=|\d+\.\d{4,}/.test(perKm))
const flat = t.hostNewBookingHtml(ctx(BENIGN), false, { address: '12 Real St', distanceKm: null, fee: 350 })
check('delivery flat :: no distance, no pin prompt', !flat.includes(' km)') && !flat.includes('map pin'))
const pickup = t.hostNewBookingHtml(ctx(BENIGN), false, null)
check('pickup :: no delivery block', !pickup.includes('Delivery to:'))
check('pickup :: identical to the two-argument call', pickup === t.hostNewBookingHtml(ctx(BENIGN), false))

// Payout statements: the spec's named payloads, and the table must survive them.
{
  const hostile = {
    ...statementCtx(BENIGN),
    reference: '"><script>alert(1)</script>',
    items: statementCtx(BENIGN).items.map((i) => ({ ...i, listingTitle: '<img src=x onerror=alert(1)>' })),
  }
  for (const [name, html] of [
    ['issued', t.payoutStatementIssuedHtml(hostile)],
    ['reversed', t.payoutStatementReversedHtml({ ...hostile, reversedOn: '2026-09-20T03:00:00Z', reversalReason: '</td></tr><script>alert(1)</script>' })],
  ]) {
    check(`statement ${name} :: no <script`, !html.includes('<script'))
    check(`statement ${name} :: no raw onerror attribute`, !/<[^>]*\sonerror=/.test(html))
    check(`statement ${name} :: no unescaped <img`, !html.includes('<img'))
    check(`statement ${name} :: booking rows intact`, (html.match(/<tr style="border-top/g) ?? []).length === 2)
    check(`statement ${name} :: table closed`, html.includes('</table>'))
    check(`statement ${name} :: CTA points at the statement`, html.includes('/dashboard/payouts/00000000-0000-4000-8000-000000000001'))
  }
  const ok = t.payoutStatementIssuedHtml(statementCtx(BENIGN))
  check('statement issued :: net line equals transferred amount', ok.includes('₱4,700') && !ok.includes('Please reply to this email'))
  check('statement issued :: renter-pays note present', ok.includes('It was not deducted from your rental rate.'))
  const off = t.payoutStatementIssuedHtml({ ...statementCtx(BENIGN), amount: 4000 })
  check('statement issued :: flags a mismatch with the recorded amount', off.includes('Please reply to this email'))
  const rev = t.payoutStatementReversedHtml({ ...statementCtx(BENIGN), reversedOn: '2026-09-20T03:00:00Z', reversalReason: 'Account closed' })
  check('statement reversed :: says bookings are owed again', rev.includes('owed to you again'))
  check('statement reversed :: reason shown', rev.includes('Account closed'))
}

// Subjects: plain text, no control characters may survive.
const subj = t.plainSubject('New message from Evil\r\nBcc: victim@example.com\n<b>x</b>')
check('plainSubject strips CR/LF', !/[\r\n]/.test(subj), JSON.stringify(subj))
check('plainSubject strips other control chars', !/[\x00-\x1f\x7f]/.test(t.plainSubject('a\x00b\tc\x7fd')))
check('plainSubject leaves a normal subject alone', t.plainSubject('Booking Confirmed — RNT-ABC123') === 'Booking Confirmed — RNT-ABC123')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
