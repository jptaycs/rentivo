// Proves src/lib/pricing.ts's calcRentalFee matches create_booking's tier
// rounding EXACTLY, against live Postgres, at the cases where float math fails.
//
// create_booking computes `round(monthly_price / 30.0 * v_days)` and
// `round(weekly_price / 7.0 * v_days)` on an integer price. Monthly:
// every (price, days) whose exact value p*d/30 ends in .5 (p*d ≡ 15 mod 30) is
// pulled from Postgres with Postgres's own answer. Weekly: a true .5 tie is
// impossible (7 is odd), so the closest cases — fraction 3/7 or 4/7 — are
// pulled instead. Prices span the numeric-weight boundaries (1e4, 1e8) and the
// leading-digit-vs-divisor boundary that change Postgres's division scale.
//
// Read-only. Usage: node --experimental-strip-types scripts/verify/079-rental-rounding-parity.mjs
import { execFileSync } from 'node:child_process'
import { check, done } from './env.mjs'
import { calcRentalFee } from '../../src/lib/pricing.ts'

const sql = (q) =>
  JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', q], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024,
  })).rows

const PRICE_RANGES = [[1, 4000], [9970, 10100], [29970, 30100], [99970, 100100], [299990, 300050], [99999990, 100000030]]
const priceSeries = PRICE_RANGES.map(([a, b]) => `select generate_series(${a}, ${b}) as p`).join(' union all ')

function pull(div, where, dFrom, dTo) {
  const rows = sql(`
    with prices as (${priceSeries}),
         cases as (
           select p, d, round(p / ${div}.0 * d)::bigint as r
           from prices, generate_series(${dFrom}, ${dTo}) d
           where ${where}
         )
    select count(*)::int as n, string_agg(p || ',' || d || ',' || r, ';') as s from cases`)
  const { n, s } = rows[0]
  return { n, cases: (s ?? '').split(';').filter(Boolean).map((x) => x.split(',').map(Number)) }
}

function compare(label, div, { n, cases }) {
  let mismatches = 0
  let oldMismatches = 0
  const sample = []
  for (const [p, d, r] of cases) {
    const listing = { daily_price: 1, weekly_price: div === 7 ? p : null, monthly_price: div === 30 ? p : null, security_deposit: 0, delivery_fee: null }
    const { rentalFee, tier } = calcRentalFee(listing, d)
    if (rentalFee !== r || tier !== (div === 30 ? 'monthly' : 'weekly')) {
      mismatches++
      if (sample.length < 5) sample.push(`p=${p} d=${d} pg=${r} js=${rentalFee}`)
    }
    if (Math.round((p / div) * d) !== r) oldMismatches++
  }
  check(`${label}: pulled every case from Postgres`, cases.length === n && n > 0, `${cases.length} of ${n}`)
  check(`${label}: calcRentalFee matches Postgres on every case`, mismatches === 0,
    `${n} cases, ${mismatches} mismatches${sample.length ? ' e.g. ' + sample.join('; ') : ''}`)
  // Discriminating: the old float version must fail somewhere on ties, or
  // these cases would not be testing anything.
  if (div === 30) check(`${label}: the old float formula DID mismatch here (the cases discriminate)`, oldMismatches > 0, `${oldMismatches} old mismatches`)
  return { n, mismatches, oldMismatches }
}

const monthly = compare('monthly (div 30) exact ties', 30, pull(30, '(p::bigint * d) % 30 = 15', 30, 365))
const weekly = compare('weekly (div 7) nearest-to-tie', 7, pull(7, '(2 * p::bigint * d) % 14 in (6, 8)', 7, 120))
console.log(`\nmonthly ties: ${monthly.n} checked, ${monthly.mismatches} mismatches (old float formula: ${monthly.oldMismatches})`)
console.log(`weekly near-ties: ${weekly.n} checked, ${weekly.mismatches} mismatches (old float formula: ${weekly.oldMismatches})`)
done()
