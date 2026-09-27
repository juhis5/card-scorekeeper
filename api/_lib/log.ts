/**
 * Server-side error logging for Vercel's function logs. Logs the error's name and message only,
 * never the request body, the image, the ID token or any key.
 */
export function logServerError(stage: string, error: unknown): void {
  const summary = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  // eslint-disable-next-line no-console -- the only diagnostics a deployed function has
  console.error(`[api/count] ${stage} failed: ${summary}`)
}
