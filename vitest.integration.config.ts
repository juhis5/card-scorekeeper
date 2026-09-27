import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Config for the `FirestoreGameRepository` emulator-backed integration test (real Firestore
 * client SDK, not `@firebase/rules-unit-testing`), run via `pnpm test:integration` under
 * `firebase emulators:exec`.
 *
 * Runs the Firestore SDK's BROWSER build (WebChannel over HTTP), not its Node build (gRPC). The
 * Node build's `Listen` stream intermittently loses its framing against the emulator — the client
 * reads protobuf bytes as a length prefix ("RESOURCE_EXHAUSTED: Received message larger than max
 * (1919182194 vs 4194304)", i.e. ASCII "rder"), backs off ~60s, and the test times out. That's an
 * open upstream bug (firebase/firebase-tools#8654), about 1 in 3 cold runs here. The app ships the
 * browser build anyway, so this is also the more faithful transport to test.
 *
 * Getting the browser build takes three settings: happy-dom (WebChannel needs XMLHttpRequest),
 * inlining `firebase` so Vite (not Node) resolves its imports, and an alias to the browser entry —
 * Vitest adds the `node` condition even for happy-dom, and `node` is listed first in
 * @firebase/firestore's export map, so conditions alone can't select it.
 *
 * Expect a few `socket hang up` lines in the output: happy-dom logs the emulator closing
 * WebChannel's hanging requests when `deleteApp` ends a channel. Harmless — a browser drops them
 * silently.
 */
const requireFromFirebase = createRequire(
  createRequire(import.meta.url).resolve('firebase/package.json'),
)
const firestoreBrowserEntry = join(
  dirname(requireFromFirebase.resolve('@firebase/firestore/package.json')),
  'dist/index.esm.js',
)

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: { alias: [{ find: /^@firebase\/firestore$/, replacement: firestoreBrowserEntry }] },
    test: {
      name: 'integration',
      environment: 'happy-dom',
      server: { deps: { inline: [/firebase/] } },
      globals: true,
      include: ['tests/integration/**/*.test.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
)
