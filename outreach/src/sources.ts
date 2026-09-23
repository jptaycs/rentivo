// Where leads come from and how they get a contact channel.
//  - Google Places API (New) text search: public business listings, the
//    legitimate way to find rental shops at scale.
//  - Website enrichment: the business's own public site, for an email address
//    and its social links. Personal profiles are never scraped.
import type { Lead, NewLead } from './db.ts'

type Place = {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
  businessStatus?: string
  primaryTypeDisplayName?: { text: string }
}

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount', 'places.googleMapsUri',
  'places.businessStatus', 'places.primaryTypeDisplayName', 'nextPageToken',
].join(',')

export async function searchPlaces(query: string, city: string, max: number): Promise<NewLead[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set (outreach/.env). Enable "Places API (New)" in Google Cloud.')
  const out: NewLead[] = []
  let pageToken: string | undefined
  do {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({
        textQuery: `${query} in ${city}, Philippines`,
        pageSize: 20,
        regionCode: 'PH',
        languageCode: 'en',
        ...(pageToken ? { pageToken } : {}),
      }),
    })
    if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { places?: Place[]; nextPageToken?: string }
    for (const p of data.places ?? []) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue
      const site = p.websiteUri ?? null
      const social = site ? classifyUrl(site) : null
      out.push({
        source: 'places',
        place_id: p.id,
        name: p.displayName?.text ?? '(unnamed)',
        city,
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: social ? null : site,
        fb_url: social === 'fb' ? site : null,
        ig_url: social === 'ig' ? site : null,
        tiktok_url: social === 'tiktok' ? site : null,
        maps_url: p.googleMapsUri ?? null,
        rating: p.rating ?? null,
        rating_count: p.userRatingCount ?? null,
        notes: p.primaryTypeDisplayName?.text ? `Google category: ${p.primaryTypeDisplayName.text}` : null,
      })
      if (out.length >= max) return out
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

export function classifyUrl(url: string): 'fb' | 'ig' | 'tiktok' | null {
  const u = url.toLowerCase()
  if (/(^|\/\/|\.)(facebook\.com|fb\.com|fb\.me)\//.test(u)) return 'fb'
  if (/(^|\/\/|\.)instagram\.com\//.test(u)) return 'ig'
  if (/(^|\/\/|\.)tiktok\.com\/@/.test(u)) return 'tiktok'
  return null
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const JUNK_EMAIL = /(\.(png|jpe?g|gif|webp|svg)$)|example\.|sentry|wixpress|@domain\.|your(name|email)@|noreply|no-reply/i
const SOCIAL_RE = /https?:\/\/(?:www\.|m\.)?(?:facebook\.com|instagram\.com|tiktok\.com\/@)[^\s"'<>)]+/gi

type SiteInfo = { emails: string[]; fb?: string; ig?: string; tiktok?: string; summary?: string }

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RentivoOutreach/1.0; +https://rentivo.live/contact)' },
    })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
    return (await res.text()).slice(0, 500_000)
  } catch {
    return null
  }
}

export async function scanWebsite(website: string): Promise<SiteInfo> {
  const base = website.startsWith('http') ? website : `https://${website}`
  const info: SiteInfo = { emails: [] }
  const pages = [base]
  for (const path of ['/contact', '/contact-us']) {
    try {
      pages.push(new URL(path, base).toString())
    } catch {
      /* bad base url */
    }
  }
  for (const [i, url] of pages.entries()) {
    const html = await fetchText(url)
    if (!html) continue
    if (i === 0) {
      const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim()
      const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i)?.[1]?.trim()
      info.summary = [title, desc].filter(Boolean).join(' — ') || undefined
    }
    const decoded = html.replace(/&#64;|\[at\]|\(at\)/gi, '@')
    for (const e of decoded.match(EMAIL_RE) ?? []) {
      const email = e.toLowerCase()
      if (!JUNK_EMAIL.test(email) && !info.emails.includes(email)) info.emails.push(email)
    }
    for (const link of html.match(SOCIAL_RE) ?? []) {
      const kind = classifyUrl(link)
      if (/sharer|share\.php|\/plugins\/|\/tr\?|\/dialog\//i.test(link)) continue
      if (kind && !info[kind]) info[kind] = link.replace(/[\\]+$/, '')
    }
    if (info.emails.length) break
  }
  return info
}

/** Best channel we can reach them on. Email is the only one we send automatically. */
export function pickChannel(l: Pick<Lead, 'email' | 'fb_url' | 'ig_url' | 'tiktok_url' | 'phone'>): string | null {
  if (l.email) return 'email'
  if (l.fb_url) return 'fb'
  if (l.ig_url) return 'ig'
  if (l.tiktok_url) return 'tiktok'
  if (l.phone) return 'phone'
  return null
}
