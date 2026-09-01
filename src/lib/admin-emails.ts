/**
 * Server-only admin allowlist (ADMIN_EMAILS env var, comma-separated).
 * Deliberately env-based, not a DB flag — see the grant-audit note in
 * AGENTS.md: nothing self-grantable may live in the database.
 * Unset/empty var ⇒ always false (the admin panel fails closed).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}
