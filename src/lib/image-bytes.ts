/**
 * Checks what an uploaded file ACTUALLY is from its first bytes, before it is
 * sent to Supabase Storage.
 *
 * Storage validates only the DECLARED content type (bucket allowed_mime_types),
 * so HTML — a phishing page, say — renamed to .png or sent with an image/png
 * label would be accepted into the public listing-images/avatars buckets and
 * served from a Rentivo-looking storage URL. The database can't see bytes, so
 * this runs in the browser.
 *
 * ⚠️ Client-side only: it stops accidents and casual abuse, not a determined
 * attacker calling the Storage API directly with their own token. The impact
 * of that bypass is bounded by origin separation — objects are served from
 * <ref>.supabase.co, not rentivo.live, so they can never script against
 * Rentivo's cookies or pages. See AGENTS.md's Security model.
 *
 * Uploads should pass the SNIFFED type as contentType, so the stored label is
 * always what the bytes are (a PNG saved as .jpg is still a real image and is
 * accepted, but stored as image/png).
 */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** Recognise JPEG, PNG, WebP or AVIF from a file's header bytes; null otherwise. */
export function sniffImageBytes(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  // ISO-BMFF: [size:4]['ftyp'][major brand:4][minor:4][compatible brands:4*n]
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const boxSize = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
    const end = Math.min(b.length, boxSize >= 16 ? boxSize : 12)
    const brands = [ascii(b, 8, 12)]
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4))
    if (brands.some((x) => x === 'avif' || x === 'avis')) return 'image/avif'
  }
  return null
}

/**
 * Reads the file's header and returns its real image type, or a readable error
 * when the bytes aren't one of `allowed`.
 */
export async function checkImageFile(
  file: File,
  allowed: readonly ImageMime[],
  what = 'file'
): Promise<{ type: ImageMime; error: null } | { type: null; error: string }> {
  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  } catch {
    return { type: null, error: `Your ${what} "${file.name}" couldn't be read. Please choose it again.` }
  }
  const type = sniffImageBytes(head)
  if (!type || !allowed.includes(type)) {
    const names = allowed.map((t) => t.split('/')[1].toUpperCase().replace('JPEG', 'JPG')).join(', ')
    return {
      type: null,
      error: `Your ${what} "${file.name}" isn't a real ${names} image — its contents don't match. Please choose a photo file.`,
    }
  }
  return { type, error: null }
}
