---
name: vue-pinia
description: Conventions for writing Vue 3 + TypeScript + Pinia code in this project. Read before creating or editing any .vue component, Pinia store, composable, or Vite config. Encodes the latest (Vue 3.5+, Pinia 3) best practices plus the mobile-first rules this app requires.
---

# Vue 3 + TypeScript + Pinia conventions

Stack: **Vite + Vue 3.5+ + TypeScript (strict) + Pinia 3 + pnpm**. Composition API only — never Options API.

## Components

- Always `<script setup lang="ts">`. One component per file, PascalCase filename (`ScoreBoard.vue`).
- **Props**: typed generic + reactive destructure with defaults (stable in 3.5):
  ```vue
  <script setup lang="ts">
  const { player, isHost = false } = defineProps<{
    player: Player
    isHost?: boolean
  }>()
  </script>
  ```
  Do not reassign destructured props (lint error). Compute derived values with `computed`.
- **Emits**: tuple syntax, typed:
  ```ts
  const emit = defineEmits<{
    score: [playerId: string, points: number]
  }>()
  ```
- **v-model**: `defineModel<T>()`, never manual `modelValue` plumbing.
- **Template refs**: `useTemplateRef('el')` (3.5).
- Keep components presentation-only. Live-sync logic lives in stores (see the `firestore-realtime` skill).

## State — `ref` vs `reactive` vs store

- Local UI state: `ref()` for primitives.
- Shared / realtime / persisted state: a **Pinia store**. Don't prop-drill more than one level.

## Pinia — setup stores only

Use the function (setup) form. Firestore subscriptions live inside the store and are cleaned up:

```ts
// src/stores/room.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useRoomStore = defineStore('room', () => {
  const players = ref<Player[]>([])
  const currentRound = ref(1)
  const standings = computed(() =>
    [...players.value].sort((a, b) => a.totalScore - b.totalScore) // low = winning
  )

  let unsubscribe: (() => void) | null = null
  function subscribe(code: string) { /* onSnapshot -> players.value = ...; see firestore-realtime */ }
  function leave() { unsubscribe?.(); unsubscribe = null }

  return { players, currentRound, standings, subscribe, leave }
})
```

- Return `ref`s/`computed`s directly. Destructure in components with `storeToRefs`; call actions off the store.
- Persist only the device identity (UUID + display name) with `pinia-plugin-persistedstate`. Never persist room/game data locally — Firestore is the source of truth.

## Composables

- `src/composables/useX.ts`. Own the "how" (camera capture, room-code input, api client). Always clean up in `onScopeDispose`/`onUnmounted`.

## Project layout

```
src/
  components/     PascalCase .vue  (ui/ = owned shadcn-vue primitives)
  views/          route-level components (Home, Room, Stats)
  stores/         Pinia setup stores (room, identity, stats)
  composables/    useX.ts
  lib/            firebase init, types, scoring rules (the 5 contracts constant) + utils.ts (cn)
  App.vue
  main.ts
```

## Architecture — lightweight layering, small components

**Not** formal Clean Architecture (no use-case classes, no DI container, no per-entity ports) — that ceremony doesn't pay off at this size. Keep the one principle that does: **the domain doesn't depend on the framework or I/O.**

- **Dependencies point inward.** `lib/` (pure domain — `rules.ts`, scoring, stats) imports nothing app-specific — no Vue, no Firebase/Gemini/`fetch`. Stores depend on `lib/` + adapter interfaces. Components depend on stores. Never the reverse.
- **Invert I/O at the boundary.** The room/game store depends on a `GameRepository` **interface**, not on Firestore directly. That is exactly what makes offline mode a clean swap — a local repository vs a Firestore repository, with no change to the domain or UI. See `firestore-realtime`.
- **Small components.** One responsibility each. When a component grows a second job, extract a child component or a composable. No business logic in templates — name it in a `computed` or move it to `lib/`. Compose small pieces instead of building big smart components.
- **Don't abstract early.** One implementation? A plain function is fine. Introduce an interface only when there's a real second implementation (offline vs online here) or a real test seam — not speculatively.

## TypeScript

- `strict: true`. No `any`. Domain types in `src/lib/types.ts` mirroring the data model in docs/PLAN.md.
- The 5-round contracts and card values are **fixed rules** — a typed constant in `src/lib/rules.ts`, not in the database.

## Environment / secrets

- Only `import.meta.env.VITE_*` reaches the browser and it is **public**. The Firebase web config is public by design (`VITE_FIREBASE_*`) — security comes from Firestore rules, not from hiding config. The Gemini key is **never** in the client; it lives only in the serverless function (see `vercel-gemini`).

## Mobile-first (hard requirement — see docs/PLAN.md)

Phones held one-handed at a card table are the only real target.

- Single-column layout; scoreboard readable for a typical group (2–6) on a 360–390px screen.
- Tap targets ≥ 44×44px. Primary actions (enter score, next round, snap hand) in the thumb zone at the bottom.
- Respect notches: `padding: env(safe-area-inset-*)`.
- Camera is first-class for photo card-count: `<input type="file" accept="image/*" capture="environment">`.
- Live scores must update without any refresh — never add a manual "refresh" button.

## Tooling

- `pnpm` for everything. `vue-tsc` in the build so type errors fail the build.
- Minimal dependencies. Firebase modular SDK is the one big one — import only the pieces used (`firebase/app`, `firebase/firestore`).
- UI is built on **shadcn-vue** (Reka UI + Tailwind v4) — copy-in, accessible components in `src/components/ui/`. See `component-library` + `design-system`.

## This project (card-scorekeeper)

Rommi (Finnish Rummy) live scorekeeper: host creates a room code, players join, scores sync live via Firestore, low total wins after 5 fixed contract rounds. Optional photo card-count via the Gemini serverless function (`vercel-gemini` skill, room-gated). Persistent per-device stats after games finish. See the `firestore-realtime` skill for the sync/identity/rules model.
