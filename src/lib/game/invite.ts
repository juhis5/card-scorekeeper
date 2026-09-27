/** A room's join link and its QR code. The caller passes `location.origin`, so previews and
 * staging link to themselves. */

export function joinUrl(origin: string, roomCode: string): string {
  return `${origin}/join/${roomCode}`
}

/** One 1×1 square per dark module, as a single path: rows are y, columns x. */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  return modules
    .flatMap((row, y) => row.map((isDark, x) => (isDark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('')
}
