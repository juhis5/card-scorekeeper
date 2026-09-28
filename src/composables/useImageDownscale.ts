/**
 * Shrinks a phone photo to a small JPEG before upload. An optimization, not the trust boundary:
 * the server enforces its own size cap (api/_lib/image.ts).
 */

export interface DownscaledImage {
  base64: string
  mimeType: string
}

const MAX_LONG_EDGE_PX = 1600
const JPEG_QUALITY = 0.8
const OUTPUT_MIME_TYPE = 'image/jpeg'

/** Fits the longer edge within `maxLongEdge`, keeping the aspect ratio. Never scales up. */
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

/** `HTMLCanvasElement` in production, a fake in tests. */
export interface DrawableCanvas {
  getContext(id: '2d'): CanvasRenderingContext2D | null
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void
}

export interface UseImageDownscaleDeps {
  /** Defaults to `createImageBitmap` with EXIF orientation, so iOS photos come out upright. */
  loadBitmap?: (file: Blob) => Promise<ImageBitmap>
  createCanvas?: (width: number, height: number) => DrawableCanvas
  blobToBase64?: (blob: Blob) => Promise<string>
}

/** Base64 via FileReader: `String.fromCharCode(...bytes)` can overflow the stack on big photos. */
function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // readAsDataURL: `result` is the data URL once `load` fires, and `error` is set by `error`.
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
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

  /** Rejects on failure; usePhotoCount turns that into a friendly result. */
  async function downscale(file: Blob): Promise<DownscaledImage> {
    const bitmap = await loadBitmap(file)
    try {
      const { width, height } = computeDownscaledDimensions(bitmap.width, bitmap.height)
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('2d canvas context unavailable')
      // A 4000px photo shrinks ~2.5x; the default "low" filter blurs the small rank/suit corners
      // the model has to read.
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, width, height)

      const blob = await encodeToJpeg(canvas)
      const base64 = await blobToBase64(blob)
      return { base64, mimeType: OUTPUT_MIME_TYPE }
    } finally {
      // Decoded pixels sit outside normal GC pressure: release them so retries can't pile up
      // memory on a phone.
      bitmap.close()
    }
  }

  return { downscale }
}
