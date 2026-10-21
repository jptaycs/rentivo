import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SITE_TAGLINE } from '@/lib/site'

// Default link preview for every page that doesn't set its own (listing pages
// use their first photo). Facebook group posts and Messenger shares pull this.
export const alt = `Rentivo — ${SITE_TAGLINE}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), 'public', 'rentivo-logo-beige.png'))
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#003049',
          color: '#FDF0D5',
          fontFamily: 'sans-serif',
        }}
      >
        <img src={logoSrc} alt="" width={520} height={260} style={{ objectFit: 'contain' }} />
        <div style={{ fontSize: 44, fontWeight: 700, marginTop: 8 }}>{SITE_TAGLINE}</div>
        <div style={{ fontSize: 28, marginTop: 20, opacity: 0.9 }}>
          Rent cameras, lenses and smartphones from verified owners in the Philippines
        </div>
        <div style={{ fontSize: 26, marginTop: 36, opacity: 0.8 }}>rentivo.live</div>
      </div>
    ),
    size
  )
}
