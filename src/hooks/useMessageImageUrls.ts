'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'

/**
 * messages.image_url is a client-written value, so only a bare storage path of
 * the exact shape `send()` produces (`<uid>/<uuid>.<ext>`) is ever treated as
 * an image. Anything else — a URL, a `../` path, garbage — is ignored and never
 * reaches the signing call or an <img>. Storage RLS (migration 075) is what
 * actually stops a crafted path from reading someone else's object; this guard
 * stops junk from being requested at all. Mirrors the DB CHECK
 * `messages_image_path_shape`.
 */
export const MESSAGE_IMAGE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpe?g|png|webp|avif)$/

export function isMessageImagePath(value: string | null | undefined): value is string {
  return typeof value === 'string' && MESSAGE_IMAGE_PATH.test(value)
}

/** Signed URLs live an hour — a normal viewing session. */
const EXPIRES_IN = 60 * 60
/** Re-sign a little before expiry so an open thread never shows broken images. */
const REFRESH_MS = (EXPIRES_IN - 5 * 60) * 1000

/**
 * Signs every valid message image path in one batched createSignedUrls call
 * (never one request per bubble). New paths (a message just sent/received) are
 * signed as they appear; everything is re-signed before expiry while mounted,
 * and remounting the conversation starts fresh.
 */
export function useMessageImageUrls(imageUrls: (string | null | undefined)[]) {
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [epoch, setEpoch] = useState(0)

  const key = useMemo(
    () => Array.from(new Set(imageUrls.filter(isMessageImagePath))).sort().join('|'),
    [imageUrls]
  )

  useEffect(() => {
    const t = setInterval(() => setEpoch((e) => e + 1), REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  // A refresh re-signs everything; otherwise only paths not yet signed.
  const [signedEpoch, setSignedEpoch] = useState(0)

  useEffect(() => {
    if (!key || !isSupabaseConfigured()) return
    const all = key.split('|')
    const refresh = epoch !== signedEpoch
    const paths = refresh ? all : all.filter((p) => !signed[p])
    if (paths.length === 0) return
    let cancelled = false
    createClient()
      .storage.from('message-images')
      .createSignedUrls(paths, EXPIRES_IN)
      .then(({ data }) => {
        if (cancelled || !data) return
        setSigned((prev) => {
          const next = { ...prev }
          for (const item of data) {
            if (item.path && item.signedUrl && !item.error) next[item.path] = item.signedUrl
          }
          return next
        })
        if (refresh) setSignedEpoch(epoch)
      })
    return () => {
      cancelled = true
    }
    // `signed` is intentionally omitted: including it would re-run after every
    // successful sign. Missing paths are recomputed whenever `key` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, epoch])

  return signed
}
