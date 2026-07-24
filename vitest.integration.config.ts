import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Config for the `FirestoreGameRepository` emulator-backed integration test (real Firestore
 * client SDK, not `@firebase/rules-unit-testing`), run via `pnpm test:integration` under
 * `firebase emulators:exec`.
 *
 * Kept SEPARATE from `pnpm test:rules` / vitest.rules.config.ts on purpose: on a *freshly booted*
 * emulator, this test intermittently hits a spurious `resource-exhausted` gRPC error opening a
 * new `Listen` stream (observed directly in this environment — Node 24 + this @grpc/grpc-js +
 * this firestore-emulator JAR version; never reproduces once the emulator has been running for a
 * while, e.g. started manually and reused). A bounded, backed-off channel warm-up in the test
 * itself (see `warmUpListenChannel`) meaningfully reduces the odds but does not eliminate them —
 * this is a transport-level race, not an application bug (the same join-order behavior has been
 * confirmed correct every time it isn't hit by this race). Isolating it here means a rare
 * environment flake can never block `pnpm test:rules`, which stays 100% required and 100%
 * reliable. Worth re-checking on a real CI runner, which may not share this exact race.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'integration',
      environment: 'node',
      globals: true,
      include: ['tests/integration/**/*.test.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
)
