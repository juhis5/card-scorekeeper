/**
 * Inviting others to a room: the link that opens its join page, and the SVG path for that link's
 * QR code. Pure: the caller passes the app's address (location.origin, so previews and
 * test-rommi link to themselves) and the QR modules from the encoder.
 */

export function joinUrl(origin: string, roomCode: string): string {
  return `${origin}/join/${roomCode}`
}

/** One 1×1 square per dark module, as a single path: rows are y, columns x. */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  return modules
    .flatMap((row, y) => row.map((isDark, x) => (isDark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('')
}
