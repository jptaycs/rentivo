/**
 * Host commission billing — shared constants and pure helpers.
 * Client-safe (no server imports). The two policy numbers below MUST match
 * generate_host_bills() in supabase/migrations/061_host_bills.sql.
 */
import type { HostBill } from '@/types'

/** Bookings marked paid at or after this instant are billable. */
export const POLICY_START = '2026-09-05T00:00:00+08:00'
export const POLICY_START_LABEL = 'September 5, 2026'
export const GRACE_DAYS = 14

/** 'YYYY-MM-01' for the UTC month before `now`. */
export function previousPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based
  const d = new Date(Date.UTC(y, m - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** 'YYYY-MM' (form input) -> 'YYYY-MM-01'; returns null when malformed. */
export function normalizePeriod(input: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(input.trim())
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

/** 'YYYY-MM-DD' -> 'January 2030'. Formats the string directly: a `date`
 *  column has no time zone, and new Date('2030-01-01') is UTC midnight,
 *  which a negative-offset runtime renders as December. */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function isOverdue(bill: Pick<HostBill, 'status' | 'due_at'>, now: Date = new Date()): boolean {
  return bill.status === 'issued' && new Date(bill.due_at).getTime() < now.getTime()
}
