// Pure date helpers shared by the search bar's calendar popover.

export function toMidnight(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isBetween(d: Date, start: Date, end: Date) {
  const t = d.getTime(), s = start.getTime(), e = end.getTime()
  return t > Math.min(s, e) && t < Math.max(s, e)
}

/** Parses a `YYYY-MM-DD` URL param into a local-midnight Date, e.g. for pre-populating the
 * calendar from `?from=&to=`. Returns null for anything missing/malformed. */
export function parseDateParam(value?: string | null): Date | null {
  if (!value) return null
  const parts = value.split('-').map(Number)
  const [y, m, d] = parts
  if (!y || !m || !d || parts.length !== 3) return null
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Formats a Date as a local `YYYY-MM-DD` string — i.e. the calendar day the user actually
 * clicked, in their own timezone. Do NOT use `d.toISOString().split('T')[0]` for this: it
 * converts to UTC first, which silently shifts the date backwards for any timezone east of
 * UTC (e.g. the Philippines, UTC+8). */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
