import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      globals: true,
      // 'tests/**' (Firestore rules + emulator-backed integration tests) needs a real Node
      // environment and a running emulator — see vitest.rules.config.ts (`pnpm test:rules`) and
      // vitest.integration.config.ts (`pnpm test:integration`). Keeping it excluded here means
      // `pnpm test:run` never depends on the emulator being up (see the tdd skill).
      exclude: [...configDefaults.exclude, 'e2e/**', 'tests/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
