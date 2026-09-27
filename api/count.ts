/**
 * Vercel serverless function: POST /api/count — the optional Gemini photo-count backend (see the
 * vercel-gemini skill). Node.js runtime (default for a plain `/api/*.ts` file without an `export
 * const config = { runtime: 'edge' }`) — required here since the Firebase Admin SDK needs Node.
 *
 * Deliberately just an adapter: all logic lives in `_lib/handler.ts` (fully unit-tested against
 * fakes) and `_lib/production-deps.ts` (the real-SDK wiring). Files under `_lib/` are excluded
 * from Vercel's file-system routing (folders starting with `_` aren't turned into functions), so
 * `/api` exposes exactly one route.
 */
import { handleCountRequest, type CountApiRequest } from './_lib/handler.js'
import { createProductionDeps } from './_lib/production-deps.js'

interface CountApiResponse {
  status(code: number): CountApiResponse
  json(body: unknown): void
}

export default async function handler(req: CountApiRequest, res: CountApiResponse): Promise<void> {
  try {
    const deps = createProductionDeps()
    const result = await handleCountRequest(req, deps)
    res.status(result.status).json(result.body)
  } catch {
    // Never surface the raw error (could be a misconfigured-env message, an SDK stack, ...) to
    // the client — a clean, generic failure either way (see clean-code's "fail loud in dev,
    // graceful in UI" and "never log image/token/keys" in the vercel-gemini skill).
    res.status(500).json({ error: 'server_error' })
  }
}
