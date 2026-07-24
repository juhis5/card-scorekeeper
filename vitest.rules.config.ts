import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Config for Firestore security-rules tests: real Node environment (not happy-dom — these hit a
 * live Firestore emulator), run only via `pnpm test:rules` under `firebase emulators:exec`. Kept
 * out of `vitest.config.ts` / `pnpm test:run` entirely so the fast happy-dom suite never depends
 * on the emulator being up (see the tdd skill).
 *
 * Deliberately scoped to `tests/rules/**` only — NOT `tests/integration/**`. The rules tests
 * (via `@firebase/rules-unit-testing`) have been 100% reliable across many dozens of runs here;
 * the plain-client-SDK integration test in `tests/integration/` has an environment-specific
 * flake on a freshly-booted emulator (see vitest.integration.config.ts's doc comment) and is run
 * separately via `pnpm test:integration` so it can never block this required, security-critical
 * gate.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'rules',
      environment: 'node',
      globals: true,
      include: ['tests/rules/**/*.test.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      // Emulator-backed tests are slower than in-memory unit tests — real gRPC round-trips.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  }),
)
