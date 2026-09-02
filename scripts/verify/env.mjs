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
