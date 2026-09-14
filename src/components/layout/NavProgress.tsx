'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A thin progress bar across the top of the page during navigation.
 *
 * Deliberately NOT a blocking overlay: a modal on every click would cover the
 * page for the 100ms most navigations take, and stop someone changing their
 * mind mid-load. This signals work without taking the page away.
 *
 * Why a click listener rather than router events: the App Router exposes no
 * navigation-start event. A capture-phase listener sees the click before
 * Next's own handler, so the bar starts the instant the link is pressed.
 * Completion keys off `usePathname()` changing.
 *
 * `useSearchParams()` is deliberately avoided — reading it here would opt
 * every page in the app into dynamic rendering (it lives in the root layout),
 * costing the static rendering of /login, /signup and the legal pages. The
 * cost is that a navigation which changes only the query string (search
 * filters) completes on the safety timeout instead of on arrival.
 */
export function NavProgress() {
  const pathname = usePathname()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (hideRef.current) { clearTimeout(hideRef.current); hideRef.current = null }
    if (safetyRef.current) { clearTimeout(safetyRef.current); safetyRef.current = null }
  }, [])

  const start = useCallback(() => {
    clearTimers()
    setVisible(true)
    setProgress(8)
    // Ease toward 90% and stop: the bar must never imply completion before
    // the page actually arrives.
    tickRef.current = setInterval(() => {
      setProgress(p => (p >= 90 ? p : p + Math.max(0.5, (90 - p) * 0.08)))
    }, 120)
    // If a navigation is cancelled (or only the query string changed, which
    // this component can't observe), don't leave the bar stuck forever.
    safetyRef.current = setTimeout(() => {
      clearTimers()
      setProgress(100)
      hideRef.current = setTimeout(() => { setVisible(false); setProgress(0) }, 250)
    }, 8000)
  }, [clearTimers])

  const complete = useCallback(() => {
    clearTimers()
    setProgress(100)
    hideRef.current = setTimeout(() => { setVisible(false); setProgress(0) }, 250)
  }, [clearTimers])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Let the browser handle anything that isn't a plain left-click
      // navigation: modified clicks open new tabs, and a prevented default
      // means something else already took the click.
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const anchor = (e.target as HTMLElement | null)?.closest?.('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return

      let url: URL
      try { url = new URL(anchor.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin) return
      // Same page: nothing will load, so nothing should animate.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      start()
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [start])

  // Arrival. Skips the first render so the bar never flashes on a cold load.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    complete()
  }, [pathname, complete])

  useEffect(() => clearTimers, [clearTimers])

  if (!visible) return null

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[60] h-0.5 bg-transparent pointer-events-none"
    >
      <div
        className="h-full bg-[#003049] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  )
}
