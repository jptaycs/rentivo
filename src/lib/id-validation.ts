'use client'

import type { FaceDetector } from '@mediapipe/tasks-vision'

/** Long-edge floor, so a thumbnail or icon can't pass on a technicality. */
export const MIN_LONG_EDGE_PX = 600

export type ValidationCode = 'no_face' | 'too_small' | 'unreadable'

export type ValidationResult =
  | { ok: true; degraded?: boolean }
  | { ok: false; code: ValidationCode; reason: string }

let detectorPromise: Promise<FaceDetector | null> | null = null

/**
 * Lazily builds the detector, once per page. Returns null (never throws) if the
 * model can't load — an old browser, a blocked asset, WASM unavailable. Callers
 * turn null into a degraded pass rather than blocking the user.
 */
async function getDetector(): Promise<FaceDetector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const vision = await import('@mediapipe/tasks-vision')
        const fileset = await vision.FilesetResolver.forVisionTasks('/models')
        return await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite' },
          runningMode: 'IMAGE',
        })
      } catch (err) {
        console.error('[id-validation] detector unavailable', err)
        return null
      }
    })()
  }
  return detectorPromise
}

async function decode(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch {
    return null
  } finally {
    // Revoked after decode; the bitmap is already in memory.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

type Inspection =
  | { kind: 'counted'; faces: number }
  | { kind: 'too_small' }
  | { kind: 'unreadable' }
  | { kind: 'degraded' }

async function inspect(file: File): Promise<Inspection> {
  const img = await decode(file)
  if (!img) return { kind: 'unreadable' }
  if (Math.max(img.naturalWidth, img.naturalHeight) < MIN_LONG_EDGE_PX) {
    return { kind: 'too_small' }
  }
  const detector = await getDetector()
  if (!detector) return { kind: 'degraded' }
  try {
    return { kind: 'counted', faces: detector.detect(img).detections.length }
  } catch (err) {
    console.error('[id-validation] detect failed', err)
    return { kind: 'degraded' }
  }
}

const NO_FACE_REASON: Record<'id' | 'selfie', string> = {
  id: "We couldn't find a face on this document. Please photograph the ID itself — the side with your photo on it — not its case, packaging, or a screenshot.",
  selfie: "We couldn't find a face in this photo. Please upload a clear photo of yourself holding your ID.",
}

/**
 * The human-readable message for a given (slot, code) pair — the single source
 * of truth for both the inline check below and any caller re-deriving a message
 * from a persisted code (e.g. after a component remounts and only the code, not
 * the original ValidationResult, survived).
 */
export function messageForCode(kind: 'id' | 'selfie', code: ValidationCode): string {
  switch (code) {
    case 'unreadable':
      return "We couldn't open that image. Try a JPG or PNG straight from your camera."
    case 'too_small':
      return `That image is too small to read. Please upload one at least ${MIN_LONG_EDGE_PX}px on its longest side.`
    case 'no_face':
      return NO_FACE_REASON[kind]
  }
}

async function requireAFace(kind: 'id' | 'selfie', file: File): Promise<ValidationResult> {
  const r = await inspect(file)
  switch (r.kind) {
    case 'unreadable':
      return { ok: false, code: 'unreadable', reason: messageForCode(kind, 'unreadable') }
    case 'too_small':
      return { ok: false, code: 'too_small', reason: messageForCode(kind, 'too_small') }
    // The detector itself failed, so nothing was actually checked. Pass, but say
    // so — the caller flags this submission for the reviewer.
    case 'degraded':
      return { ok: true, degraded: true }
    case 'counted':
      // "At least one", never "exactly one" — a correct "selfie with ID" contains
      // the holder's face AND the portrait printed on the document.
      return r.faces >= 1 ? { ok: true } : { ok: false, code: 'no_face', reason: messageForCode(kind, 'no_face') }
  }
}

export function validateIdDocument(file: File): Promise<ValidationResult> {
  return requireAFace('id', file)
}

export function validateSelfie(file: File): Promise<ValidationResult> {
  return requireAFace('selfie', file)
}
