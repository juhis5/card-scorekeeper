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
import { logServerError } from './_lib/log.js'
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
  } catch (error) {
    // Logged for Vercel (name and message only, see log.ts), never shown to the client: a
    // misconfigured env or an SDK error gets the same generic 500.
    logServerError('request', error)
    res.status(500).json({ error: 'server_error' })
  }
}
