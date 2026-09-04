// Shared harness for verification scripts. Reads .env.local the same way the
// app does, and exposes service-role + anon fetch helpers.
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
export const SECRET = process.env.SUPABASE_SECRET_KEY

if (!URL || !ANON || !SECRET) throw new Error('Missing Supabase env in .env.local')

/** Service-role request — bypasses RLS. Use for setup/teardown and assertions. */
export async function admin(path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SECRET, Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Anon-key request, optionally as a signed-in user. This is the ONLY way to
 *  exercise RLS — the service role bypasses it entirely and proves nothing. */
export async function asUser(accessToken, path, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON, Authorization: `Bearer ${accessToken ?? ANON}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Sign in a demo/probe account and return its access token. */
export async function signIn(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(json)}`)
  return json.access_token
}

/**
 * Safety guard for any script that calls generate_host_bills (globally, no
 * host filter) or the real cron/admin-run billing routes against probe or
 * completed-month periods. generate_host_bills has no lower bound on
 * paid_at — it bills every eligible unbilled host_qr booking regardless of
 * age — so a probe-period run would sweep in any REAL host's eligible
 * booking, permanently itemize it against a fake bill, and (via the cron
 * route) email that host. Call this once, before the first such call, and
 * treat any hit as a hard stop, not a warning.
 */
export async function assertNoRealEligibleHostBillingBookings() {
  const POLICY_START = '2026-09-05T00:00:00+08:00'
  const { body: candidates } = await admin(
    `bookings?select=id&payment_method=eq.host_qr&payment_status=eq.paid&status=neq.cancelled&paid_at=gte.${encodeURIComponent(POLICY_START)}&service_fee=gt.0`
  )
  if (!candidates.length) return
  const ids = candidates.map((c) => c.id)
  const { body: itemized } = await admin(`host_bill_items?select=booking_id&booking_id=in.(${ids.join(',')})`)
  const billedIds = new Set(itemized.map((i) => i.booking_id))
  const realEligible = ids.filter((id) => !billedIds.has(id))
  if (realEligible.length > 0) {
    console.log(
      `ABORTING: ${realEligible.length} real host_qr booking(s) eligible for billing (paid_at >= POLICY_START, unbilled): ${realEligible.join(', ')}. ` +
        'This script runs generate_host_bills globally / calls the real cron or admin-run billing route, and would sweep them into a probe bill or ' +
        'trigger a real billing run that emails a real host. Investigate before running.'
    )
    process.exit(1)
  }
}

let failures = 0
export function check(label, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

/** Call at the end of a verification script. Exits 0 when every check
 *  passed, 1 otherwise — the normal shell convention (not inverted; the
 *  brief this was copied from had this backwards, fixed here). */
export function done() {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}
