import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Config for the `/api/count` photo-count function's unit tests: real Node environment (matches
 * the Vercel Node.js runtime it actually runs under), fully mocked Admin SDK + Gemini SDK — no
 * emulator, no live credentials, no network (see the tdd skill: "Mock the Gemini SDK and the
 * Admin SDK").
 *
 * Kept OUT of `vitest.config.ts` / `pnpm test:run` (which stays happy-dom, app-only, and
 * emulator-free) via that config's own `exclude: [..., 'api/**']` — so the app test count never
 * shifts because of this slice. Run via `pnpm test:api`.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'api',
      environment: 'node',
      globals: true,
      include: ['api/**/*.test.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
