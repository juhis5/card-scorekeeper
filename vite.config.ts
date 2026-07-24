import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    // Precaches the app SHELL (this build's JS/CSS/HTML/icons) so the offline host can open the
    // app cold, with no network, and start a local game — the missing half of offline host mode
    // (`LocalGameRepository` + `lib/rules.ts` are the other half). See the `pwa` skill.
    //
    // `registerType: 'prompt'` (not `autoUpdate`): an abrupt SW-driven reload mid-round would
    // lose a game in progress at the card table, so a new deploy waits for `useServiceWorker`'s
    // update prompt (see `src/composables/useServiceWorker.ts` + `App.vue`) instead of reloading
    // on its own.
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Card Scorekeeper',
        short_name: 'Scores',
        description: 'Live scorekeeper for Rommi (Finnish Rummy)',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The shell only — Firestore's own requests (firestore.googleapis.com et al.) and the
        // `/api` photo-count call are never matched by this glob, so they're untouched by the SW
        // and pass straight through to the network. Firestore manages its own offline behavior
        // via `persistentLocalCache` (see `src/lib/firebase.ts`); the SW must not shadow it with
        // a second, conflicting cache.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
