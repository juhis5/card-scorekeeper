/**
 * Server-side image size cap — defence-in-depth behind the client-side downscale (see the
 * vercel-gemini skill: "Downscale the image in the browser before upload"). The client resize
 * targets well under ~1.5 MB; this cap is the trust boundary, not the optimisation.
 */

/** ~1.5 MB of decoded image bytes — matches the client downscale target in the vercel-gemini
 * skill, with headroom for JPEG quality variance. */
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
