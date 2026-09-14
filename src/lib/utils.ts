import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const REDIRECT_BASE = 'https://rentivo.invalid'

/** ASCII control characters (0x00-0x1F, 0x7F), any whitespace, or a backslash. */
function hasUnsafeRedirectChar(value: string) {
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f || ch === '\\' || /\s/.test(ch)) return true
  }
  return false
}

/**
 * Only allow same-origin paths for `?next=` redirects.
 *
 * A prefix check alone is NOT enough (security audit 2, MEDIUM-2): the WHATWG
 * URL parser that `router.push` and the browser use strips tab/CR/LF anywhere
 * and treats `\` like `/`, so `"/\t/evil.example.com"` passed a `startsWith('//')`
 * test and still navigated to https://evil.example.com/. So:
 *   1. reject any ASCII control character, any whitespace, and any backslash;
 *   2. parse against a fixed base and require the origin to be unchanged;
 *   3. return the PARSED pathname + search + hash, never the raw input — and
 *      reject a parsed pathname starting `//` (e.g. `/.//evil.com` normalises
 *      to `//evil.com`, which a browser would read as scheme-relative).
 */
export function safeRedirectPath(path: string | null | undefined, fallback = '/') {
  if (typeof path !== 'string' || !path.startsWith('/')) return fallback
  if (hasUnsafeRedirectChar(path)) return fallback
  if (path.startsWith('//')) return fallback

  let url: URL
  try {
    url = new URL(path, REDIRECT_BASE)
  } catch {
    return fallback
  }
  if (url.origin !== REDIRECT_BASE) return fallback

  const result = `${url.pathname}${url.search}${url.hash}`
  if (!result.startsWith('/') || result.startsWith('//')) return fallback
  return result
}
