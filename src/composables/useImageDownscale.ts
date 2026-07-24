/**
 * Resizes a photo to a small, fast-to-upload JPEG before it ever reaches the network — the
 * client-side optimization the vercel-gemini skill calls for ("Downscale the image in the
 * browser before upload"). A raw phone photo is 5–12 MB; this gets it down to ~1600px on the
 * long edge at JPEG quality ~0.8, comfortably under ~1.5 MB for a hand-of-cards photo.
 *
 * This is an OPTIMIZATION, not the trust boundary: `api/_lib/image.ts`'s size cap (a 413 on an
 * oversized payload) is the real defence-in-depth check — a client can always be bypassed, so the
 * server never assumes an upload it receives is already small.
 *
 * Every browser call (`createImageBitmap`, canvas, `FileReader`) is injectable via `deps` so the
 * highest-value part — the dimension math — is a plain unit test, and the rest is tested with
 * fakes instead of a real canvas/bitmap/file (see the tdd skill's "mock at the boundary").
 */

export interface DownscaledImage {
  base64: string
  mimeType: string
}

const MAX_LONG_EDGE_PX = 1600
const JPEG_QUALITY = 0.8
const OUTPUT_MIME_TYPE = 'image/jpeg'

/**
 * Scales `width`×`height` down so the longer edge is at most `maxLongEdge`, preserving aspect
 * ratio — never scales up (a photo already smaller than the cap is left alone). Pure; the
 * highest-value thing to test here (see the tdd skill).
 */
export function computeDownscaledDimensions(
  width: number,
  height: number,
  maxLongEdge: number = MAX_LONG_EDGE_PX,
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxLongEdge / longEdge
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** A canvas-like 2D drawing surface — `HTMLCanvasElement` in production, a fake in tests. */
export interface DrawableCanvas {
  getContext(id: '2d'): CanvasRenderingContext2D | null
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void
}

export interface UseImageDownscaleDeps {
  /** Defaults to `createImageBitmap(file, { imageOrientation: 'from-image' })` — respects EXIF
   * rotation from iOS photos (see the vercel-gemini skill). */
  loadBitmap?: (file: Blob) => Promise<ImageBitmap>
  createCanvas?: (width: number, height: number) => DrawableCanvas
  blobToBase64?: (blob: Blob) => Promise<string>
}

/** Reads a `Blob` back out as base64 (no `data:` prefix) via `FileReader` — avoids building a
 * giant `String.fromCharCode(...bytes)` call, which can blow the call stack on a multi-MB photo. */
function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('failed to read image data'))
    reader.readAsDataURL(blob)
  })
}

function createHtmlCanvas(width: number, height: number): DrawableCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function encodeToJpeg(canvas: DrawableCanvas): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas encoding failed'))),
      OUTPUT_MIME_TYPE,
      JPEG_QUALITY,
    )
  })
}

export function useImageDownscale(deps: UseImageDownscaleDeps = {}) {
  const loadBitmap =
    deps.loadBitmap ?? ((file: Blob) => createImageBitmap(file, { imageOrientation: 'from-image' }))
  const createCanvas = deps.createCanvas ?? createHtmlCanvas
  const blobToBase64 = deps.blobToBase64 ?? readBlobAsBase64

  /** Downscales `file` to ~1600px on the long edge, JPEG quality ~0.8. Never throws by design of
   * its only caller (`usePhotoCount`) — a rejection here is caught at that boundary and mapped to
   * a friendly "couldn't read the cards" result, never a crash. */
  async function downscale(file: Blob): Promise<DownscaledImage> {
    const bitmap = await loadBitmap(file)
    try {
      const { width, height } = computeDownscaledDimensions(bitmap.width, bitmap.height)
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('2d canvas context unavailable')
      context.drawImage(bitmap, 0, 0, width, height)

      const blob = await encodeToJpeg(canvas)
      const base64 = await blobToBase64(blob)
      return { base64, mimeType: OUTPUT_MIME_TYPE }
    } finally {
      // Bitmaps hold decoded pixel memory outside normal GC pressure — always release it, success
      // or failure, so a string of retries (a flaky read, a player retaking the photo) can't pile
      // up memory on a phone.
      bitmap.close()
    }
  }

  return { downscale }
}
