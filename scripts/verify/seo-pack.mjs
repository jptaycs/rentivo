// Checks the free-growth SEO pack against a running server (local prod build or
// production). Usage: node scripts/verify/seo-pack.mjs [baseUrl]
// Default base is http://localhost:3177. Read-only: nothing is written anywhere.
const base = (process.argv[2] ?? 'http://localhost:3177').replace(/\/$/, '')
let pass = 0, fail = 0
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log(`  ok   ${label}`) } else { fail++; console.log(`  FAIL ${label} ${extra}`) } }
const text = async (p) => { const r = await fetch(`${base}${p}`, { redirect: 'manual' }); return { status: r.status, headers: r.headers, body: await r.text() } }
const meta = (h, k) => h.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`))?.[1]
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")

console.log(`SEO pack against ${base}`)
const robots = await text('/robots.txt')
ok(robots.status === 200 && /Allow: \//.test(robots.body), 'robots.txt served')
ok(/Disallow: \/admin/.test(robots.body) && /Disallow: \/dashboard/.test(robots.body) && /Disallow: \/api\//.test(robots.body), 'robots disallows admin, dashboard, api')
ok(/Sitemap: .*\/sitemap\.xml/.test(robots.body), 'robots points at sitemap')

const sm = await text('/sitemap.xml')
const urls = [...sm.body.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => unesc(m[1]))
ok(sm.status === 200 && urls.length > 10, `sitemap has ${urls.length} urls`)
const listingUrls = urls.filter((u) => /\/listings\//.test(u))
ok(listingUrls.length > 0, `sitemap lists ${listingUrls.length} listings`)
ok(urls.some((u) => /\/search\?category=/.test(u)), 'sitemap has category search urls')
ok(urls.some((u) => /\/search\?city=/.test(u)), 'sitemap has city search urls')
ok(!urls.some((u) => /\/(dashboard|admin|api)\b/.test(u)), 'sitemap has no private urls')

const lid = listingUrls[0]?.replace(/^.*\/listings\//, '')
const lp = await text(`/listings/${lid}`)
const title = lp.body.match(/<title>(.*?)<\/title>/)?.[1] ?? ''
ok(lp.status === 200 && /for rent in .* — ₱[\d,]+\/day \| Rentivo/.test(unesc(title)), 'listing title has name, city, price', title)
ok(/^https?:\/\//.test(meta(lp.body, 'og:image') ?? ''), 'listing og:image is absolute')
ok((meta(lp.body, 'description') ?? '').length >= 40, 'listing description present')
ok(/<link rel="canonical" href="[^"]*\/listings\//.test(lp.body), 'listing canonical')
const ld = [...lp.body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(unesc(m[1])))
const types = ld.flatMap((d) => (d['@graph'] ?? [d]).map((g) => g['@type']))
ok(types.includes('Product') && types.includes('BreadcrumbList') && types.includes('Organization') && types.includes('WebSite'), `structured data types: ${types.join(', ')}`)
const product = ld.flatMap((d) => d['@graph'] ?? [d]).find((g) => g['@type'] === 'Product')
ok(product?.offers?.priceCurrency === 'PHP' && typeof product?.offers?.price === 'number', 'product offer in PHP')
ok(!/street_address|latitude"/.test(JSON.stringify(ld)), 'structured data leaks no private fields')

const s1 = await text('/search?category=lens&city=Quezon%20City')
ok(/<title>Camera lens rentals in Quezon City \| Rentivo<\/title>/.test(s1.body), 'search title from category + city', s1.body.match(/<title>.*?<\/title>/)?.[0])
ok(/rel="canonical" href="[^"]*\/search\?category=lens&amp;city=Quezon\+City"/.test(s1.body), 'search canonical keeps only category + city')
const s2 = await text('/search?q=sony&min_price=100')
ok(/name="robots" content="noindex, follow"/.test(s2.body), 'free-text search is noindex')
ok(/rel="canonical" href="[^"]*\/search"/.test(s2.body), 'free-text search canonical is bare /search')
const s3 = await text('/search?category=mirrorless&from=2026-11-01&to=2026-11-03')
ok(!/name="robots" content="noindex/.test(s3.body), 'category search with dates stays indexable')

const home = await text('/')
ok(/og:image" content="[^"]*opengraph-image/.test(home.body), 'home uses the default og image')
const og = await fetch(`${base}/opengraph-image`)
ok(og.status === 200 && og.headers.get('content-type') === 'image/png', 'default og image is a png')
const csp = home.headers.get('content-security-policy') ?? ''
ok(csp.includes('va.vercel-scripts.com'), 'CSP allows the analytics host')
ok(/application\/ld\+json/.test(home.body) && /"@type":"Organization"/.test(home.body), 'home has Organization json-ld')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
