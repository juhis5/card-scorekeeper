import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Vercel's build tells which branch and commit it builds; error reports carry both.
const branch = process.env.VERCEL_GIT_COMMIT_REF
const deployEnv =
  branch === 'main' ? 'production' : branch === 'develop' ? 'test' : branch ? 'preview' : 'local'
const release = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
// Source maps go to Sentry only, never to the browser: made hidden, uploaded, then deleted.
const uploadsSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN && release)

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    // Precaches the app shell, so the offline host can open the app with no network and start a
    // local game. 'prompt', not 'autoUpdate': a reload mid-round would lose the game, so a new
    // deploy waits for the app's update prompt.
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rommi',
        short_name: 'Rommi',
        description: 'Live scorekeeper for Rommi (Finnish Rummy)',
        theme_color: '#16100c',
        background_color: '#16100c',
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
        // The shell only. Firestore and /api requests go straight to the network: Firestore keeps
        // its own offline cache (src/lib/data/firebase.ts), and a second one here would conflict.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
    ...(uploadsSourceMaps
      ? [
          sentryVitePlugin({
            org: 'juho-lahtinen',
            project: 'rommi',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: release },
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  define: {
    'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(deployEnv),
    'import.meta.env.VITE_RELEASE': JSON.stringify(release),
  },
  build: {
    sourcemap: uploadsSourceMaps ? 'hidden' : false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
