---
name: pwa
description: How to make this app an installable PWA with an offline-capable app shell using vite-plugin-pwa + Workbox. Read before adding the manifest, service worker, or app icons. This is the missing half of offline host mode — without a precached shell the app won't load with no network.
---

# PWA — installable + the shell that makes offline host mode real

The `firestore-realtime` skill gives an offline **data** layer (`LocalGameRepository`). But data is useless if the app itself won't load offline. **This service worker precaches the app shell so the host can open and play a local game cold, with no network.** Use `vite-plugin-pwa` (Workbox) — install latest stable: `pnpm add -D vite-plugin-pwa`.

## Setup

```ts
// vite.config.ts (abridged)
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt', // never reload mid-game; see Registration UX
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rommi',
        short_name: 'Rommi',
        description: 'Live scorekeeper for Rommi (Finnish Rummy)',
        theme_color: '#16100c', // Kapteeni's background
        background_color: '#16100c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        handle_links: 'preferred', // a scanned invite opens the installed app (Android)
        launch_handler: { client_mode: 'navigate-existing' },
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})
```

## What to cache — and what NOT to

- **Precache the app shell** (build output). This is the piece that makes offline host mode load. Combined with `LocalGameRepository` + the pure `lib/game/rules.ts`, the host can start and finish a game entirely offline.
- **Do NOT have the SW cache Firestore or the Gemini `/api` call.** Firestore manages its own offline via `persistentLocalCache` (see `firestore-realtime`) — let its requests pass through. The photo-count call is online-only; leave it NetworkOnly.
- Net effect: shell from the SW cache, live data from Firestore's own cache, offline scoring from the local repository. Three layers, each owning its part.

## Icons

- Real `pwa-192.png`, `pwa-512.png`, maskable 512 (safe-zone padded), `apple-touch-icon.png` (180×180) in `public/`. Generate from one source (`@vite-pwa/assets-generator`). Placeholders fine to start.

## iOS notes

- iOS supports install + `apple-touch-icon` but thinner PWA support than Android; test the installed app on a real iPhone. Camera (`capture="environment"`) works in Safari for photo-count.

## Registration UX

- `registerType: 'prompt'`: the `app-update` store wraps `useRegisterSW`, and a waiting version shows as a banner and a menu row; the player chooses when to reload, so a game is never interrupted mid-round. An installed app may stay open for hours, so `lib/platform/update-checks.ts` also checks every 30 minutes and when the app comes back on screen.

## Testing

- `pnpm build && pnpm preview`, DevTools → Application → Offline: the shell must still load **and** you must be able to start a local game. Lighthouse → PWA for manifest/icon gaps. SW runs only over HTTPS / `localhost`.

## This project (card-scorekeeper)

Treat the SW shell as a **hard requirement**, not a nice-to-have — it's what turns "offline data layer" into "the host can actually open the app and play with no signal." Verify the offline-cold-start path explicitly in testing.
