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

/** 100% on the logic layers (the owner's target); a floor that only goes up on components and
 * views. Their numbers here are the floor: raise them when coverage rises, never lower them. */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 }

/** One project per suite; rules and integration need the emulator (`pnpm test:rules` etc.). */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'json-summary'],
        include: ['src/**/*.{ts,vue}', 'api/**/*.ts'],
        exclude: [
          '**/*.test.ts',
          '**/*.d.ts',
          // Owned shadcn-vue copies: upstream's, tested there.
          'src/components/ui/**',
          // Wiring, not logic: the real SDKs and runtime, exercised by tests/integration (the
          // Firestore emulator), `pnpm test:api-load` and production, not by unit tests.
          'src/main.ts',
          'src/lib/data/firebase.ts',
          'api/count.ts',
          'api/_lib/firebase-admin.ts',
          'api/_lib/production-deps.ts',
        ],
        thresholds: {
          'src/lib/**': FULL,
          'src/stores/**': FULL,
          'src/composables/**': FULL,
          'api/_lib/**': FULL,
          'src/components/**': { lines: 97, branches: 90.7, functions: 96.2, statements: 95.5 },
          'src/views/**': { lines: 96.5, branches: 90.6, functions: 97.3, statements: 95.2 },
        },
      },
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
