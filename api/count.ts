/**
 * POST /api/count, the optional Gemini photo count: a thin adapter over `_lib/handler.ts`. Node
 * runtime, which the Firebase Admin SDK needs. Vercel doesn't route `_lib/`, so this is the only
 * function.
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
    // Logged, never shown to the client: a misconfigured env or an SDK error gets the same 500.
    logServerError('request', error)
    res.status(500).json({ error: 'server_error' })
  }
}
