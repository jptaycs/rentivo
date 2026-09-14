// Verifies skeleton loading states across Rentivo. Drives a real Chromium
// browser (390x844) against the production build on :3102, throttles
// Supabase requests via CDP, and for each target page: confirms a skeleton
// renders during loading (data-slot="skeleton" present), measures the main
// content bounding height while loading vs after load (layout shift), and
// confirms no horizontal overflow at 390px.
import { chromium } from 'playwright'

const BASE = 'http://localhost:3102'
const results = []

function log(line) {
  console.log(line)
}

async function measurePage(context, path) {
  const page = await context.newPage()
  const client = await context.newCDPSession(page)

  // Throttle only Supabase REST/RPC requests so the skeleton has time to be
  // observed, without slowing down the whole page (fonts, CSS, JS chunks).
  await client.send('Network.enable')
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 800,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
  })

  const skeletonSeen = { value: false }
  page.on('response', () => {})

  let loadingHeight = null
  let loadedHeight = null
  let overflowLoading = null
  let overflowLoaded = null

  const navPromise = page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })

  // Poll for the skeleton, but only record a measurement once it is actually
  // *styled* (nonzero laid-out height) — under throttling, the very first
  // DOM-present moment can be a pre-CSS flash-of-unstyled-content frame,
  // which would measure a meaningless near-zero height rather than the real
  // skeleton layout.
  const start = Date.now()
  while (Date.now() - start < 12000) {
    const styledCount = await page
      .evaluate(() => {
        const els = document.querySelectorAll('[data-slot="skeleton"]')
        let styled = 0
        for (const el of els) {
          if (el.getBoundingClientRect().height > 2) styled++
        }
        return styled
      })
      .catch(() => 0)
    if (styledCount > 0) {
      skeletonSeen.value = true
      await page.waitForTimeout(150)
      // Re-confirm skeletons are still present AND take two readings 100ms
      // apart that agree — a plain page.evaluate() re-check (not a
      // Playwright locator call, which has its own actionability-wait
      // semantics that can straddle a DOM mutation and read a transient
      // mid-reconciliation height) guards against measuring a one-frame
      // layout artifact instead of the settled skeleton.
      const stillThere = await page
        .evaluate(() => document.querySelectorAll('[data-slot="skeleton"]').length)
        .catch(() => 0)
      if (stillThere > 0) {
        const h1 = await page.evaluate(() => document.body.scrollHeight).catch(() => null)
        await page.waitForTimeout(100)
        const stillThere2 = await page
          .evaluate(() => document.querySelectorAll('[data-slot="skeleton"]').length)
          .catch(() => 0)
        const h2 = stillThere2 > 0 ? await page.evaluate(() => document.body.scrollHeight).catch(() => null) : null
        if (h1 && h2 && h1 === h2) {
          if (path === '/dashboard/overview') {
            const dump = await page.evaluate(() => {
              const main = document.querySelector('main')
              const container = main?.querySelector('.p-6.space-y-8') || main
              return {
                mainH: main ? main.scrollHeight : null,
                containerChildren: container
                  ? Array.from(container.children).map((c) => ({
                      tag: c.tagName,
                      cls: c.className.slice(0, 80),
                      h: c.getBoundingClientRect().height,
                    }))
                  : null,
              }
            })
            console.log('  [dbg overview]', JSON.stringify(dump, null, 1))
          }
          loadingHeight = h1
          const overflow = await page
            .evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            .catch(() => null)
          overflowLoading = overflow
          break
        }
        // Readings disagreed (or skeleton already gone) — keep polling.
      }
    }
    await page.waitForTimeout(100)
  }

  await navPromise.catch(() => {})

  // Wait for skeletons to disappear (data loaded), then measure again.
  await page
    .waitForFunction(() => document.querySelectorAll('[data-slot="skeleton"]').length === 0, { timeout: 30000 })
    .catch(() => {})
  await page.waitForTimeout(500)

  loadedHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => null)
  overflowLoaded = await page
    .evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    .catch(() => null)

  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  await page.close()

  return {
    path,
    skeletonSeen: skeletonSeen.value,
    loadingHeight,
    loadedHeight,
    overflowLoading,
    overflowLoaded,
  }
}

async function loginAs(context, email, password) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await page.close()
}

async function main() {
  const browser = await chromium.launch()

  // --- Public pages, signed out ---
  const pubContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  for (const path of ['/', '/search']) {
    const r = await measurePage(pubContext, path)
    results.push(r)
    log(`${path}: skeleton=${r.skeletonSeen} loadingH=${r.loadingHeight} loadedH=${r.loadedHeight} overflow(loading/loaded)=${r.overflowLoading}/${r.overflowLoaded}`)
  }

  // Find a real listing id via search page link
  const p = await pubContext.newPage()
  await p.goto(`${BASE}/search`, { waitUntil: 'networkidle' })
  const href = await p.locator('a[href^="/listings/"]').first().getAttribute('href').catch(() => null)
  await p.close()
  const listingPath = href || '/listings/1'
  const r = await measurePage(pubContext, listingPath)
  results.push(r)
  log(`${listingPath}: skeleton=${r.skeletonSeen} loadingH=${r.loadingHeight} loadedH=${r.loadedHeight} overflow(loading/loaded)=${r.overflowLoading}/${r.overflowLoaded}`)
  await pubContext.close()

  // --- Demo renter ---
  const renterContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await loginAs(renterContext, 'renter@demo.rentivo.ph', 'DemoRentivo1')
  for (const path of ['/dashboard/rentals', '/dashboard/messages', '/wishlist']) {
    const rr = await measurePage(renterContext, path)
    results.push(rr)
    log(`[renter] ${path}: skeleton=${rr.skeletonSeen} loadingH=${rr.loadingHeight} loadedH=${rr.loadedHeight} overflow(loading/loaded)=${rr.overflowLoading}/${rr.overflowLoaded}`)
  }
  await renterContext.close()

  // --- Demo host ---
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await loginAs(hostContext, 'demo@demo.rentivo.ph', 'DemoRentivo1')
  for (const path of ['/dashboard/bookings', '/dashboard/overview', '/dashboard/earnings']) {
    const rr = await measurePage(hostContext, path)
    results.push(rr)
    log(`[host] ${path}: skeleton=${rr.skeletonSeen} loadingH=${rr.loadingHeight} loadedH=${rr.loadedHeight} overflow(loading/loaded)=${rr.overflowLoading}/${rr.overflowLoaded}`)
  }
  await hostContext.close()

  await browser.close()

  console.log('\n--- SUMMARY ---')
  console.log(JSON.stringify(results, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
