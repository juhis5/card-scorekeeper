/** The server-side image size cap: the trust boundary behind the client's downscale. */

/** ~1.5 MB decoded: above the client's downscale target, with headroom for JPEG quality. */
export const MAX_IMAGE_BYTES = 1_500_000

/** Decoded byte length of a base64 string, without allocating a buffer for it. */
export function base64ByteLength(base64: string): number {
  const trimmed = base64.trim()
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.floor((trimmed.length * 3) / 4) - padding
}

export function exceedsSizeCap(base64Image: string, maxBytes: number = MAX_IMAGE_BYTES): boolean {
  return base64ByteLength(base64Image) > maxBytes
}
