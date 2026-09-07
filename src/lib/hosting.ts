/**
 * Hosting-tenure formatting, shared by the listing page's HostCard and the host
 * profile page so the two can never disagree again. They used to: the card
 * derived "Years hosting" from the account's *signup* year (and floored it at
 * 1 yr, so a two-month-old host read as a one-year host), while the profile
 * derived "Hosting since" from the host's first listing.
 *
 * Client-safe — no server-only imports — but callers should still format on the
 * server and pass strings down, so a UTC server and a +08 browser can't render
 * two different dates and trip a hydration mismatch.
 */

/** "July 18, 2026" — matches the host profile page's stat exactly. */
export function formatHostingSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Whole months elapsed since `iso`, as "New host" / "8 months" / "2 years".
 * Anything under a month — or an unparseable date — is "New host" rather than
 * a rounded-up number, since inventing tenure is the bug this replaces.
 */
export function formatHostingDuration(iso: string, now: Date = new Date()): string {
  const since = new Date(iso)
  let months =
    (now.getFullYear() - since.getFullYear()) * 12 + (now.getMonth() - since.getMonth())
  // Not a full month yet if the day-of-month hasn't come round.
  if (now.getDate() < since.getDate()) months -= 1

  if (!Number.isFinite(months) || months < 1) return 'New host'
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`

  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'}`
}
