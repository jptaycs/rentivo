import Link from 'next/link'
import Image from 'next/image'

/**
 * The Rentivo lockup: the aperture mark beside a live text wordmark.
 *
 * One component because this markup was previously copy-pasted across six
 * surfaces (navbar, footer, 404, host wizard, auth shell, dashboard sidebar)
 * and had already drifted into three different logo files at four sizes.
 *
 * `tone` picks the wordmark colour: 'dark' for the app's light surfaces,
 * 'cream' for the navy panels. The mark itself is a navy tile, so on a dark
 * surface it reads as the cream aperture with a barely-visible tile edge —
 * checked on the auth panel and the footer rather than assumed.
 */
const SIZES = {
  sm: { px: 32, mark: 'w-8 h-8', text: 'text-lg' },
  md: { px: 36, mark: 'w-9 h-9', text: 'text-xl' },
  lg: { px: 44, mark: 'w-11 h-11', text: 'text-2xl' },
} as const

export function Logo({
  size = 'md',
  tone = 'dark',
  href = '/',
  priority = false,
  className = '',
  onClick,
}: {
  size?: keyof typeof SIZES
  tone?: 'dark' | 'cream'
  /** Pass null to render the lockup without wrapping it in a link. */
  href?: string | null
  priority?: boolean
  className?: string
  onClick?: () => void
}) {
  const s = SIZES[size]
  const lockup = (
    <>
      {/* alt="" — decorative: the wordmark beside it already names the link,
          and a described mark would announce "Rentivo" twice. */}
      <Image src="/rentivo-mark.png" alt="" width={s.px} height={s.px} className={s.mark} priority={priority} />
      <span
        className={`${s.text} font-bold tracking-tight ${tone === 'cream' ? 'text-[#FDF0D5]' : 'text-[#003049]'}`}
      >
        Rentivo
      </span>
    </>
  )

  if (href === null) {
    return <span className={`inline-flex items-center gap-2.5 ${className}`}>{lockup}</span>
  }

  return (
    <Link href={href} onClick={onClick} className={`shrink-0 inline-flex items-center gap-2.5 ${className}`}>
      {lockup}
    </Link>
  )
}
