import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Integration tests run the Firestore SDK's browser build: its Node build intermittently loses
 * framing against the emulator (firebase/firebase-tools#8654), and the app ships the browser build
 * anyway. Vitest adds the `node` condition even under happy-dom, so an alias picks the entry.
 */
const requireFromFirebase = createRequire(
  createRequire(import.meta.url).resolve('firebase/package.json'),
)
const firestoreBrowserEntry = join(
  dirname(requireFromFirebase.resolve('@firebase/firestore/package.json')),
  'dist/index.esm.js',
)

/** One project per suite; rules and integration need the emulator (`pnpm test:rules` etc.). */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      root: fileURLToPath(new URL('./', import.meta.url)),
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'happy-dom',
            include: ['src/**/*.test.ts'],
            // Agent worktrees are full repo copies whose tests must not be collected.
            exclude: [...configDefaults.exclude, '.claude/**'],
          },
        },
        {
          extends: true,
          test: { name: 'api', environment: 'node', include: ['api/**/*.test.ts'] },
        },
        {
          extends: true,
          test: {
            name: 'rules',
            environment: 'node',
            include: ['tests/rules/**/*.test.ts'],
            testTimeout: 20_000,
            hookTimeout: 20_000,
          },
        },
        {
          extends: true,
          resolve: {
            alias: [{ find: /^@firebase\/firestore$/, replacement: firestoreBrowserEntry }],
          },
          test: {
            name: 'integration',
            environment: 'happy-dom',
            // Inlined so Vite, not Node, resolves firebase's imports (and the alias above applies).
            server: { deps: { inline: [/firebase/] } },
            include: ['tests/integration/**/*.test.ts'],
            setupFiles: ['tests/integration/beacon.setup.ts'],
            testTimeout: 30_000,
            hookTimeout: 30_000,
          },
        },
      ],
    },
  }),
)
