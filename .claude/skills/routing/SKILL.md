---
name: routing
description: Vue Router conventions — route definitions, lazy-loading/code-splitting, named routes, thin navigation guards that delegate to stores, scroll + focus behavior, 404, offline. Read before adding routes, guards, or navigation. Establish these from the start; retrofitting routing is painful.
---

# Routing — Vue Router, thin and lazy

Stack: **Vue Router 5**, `createWebHistory` (SPA — pairs with the Vercel SPA rewrite in `vercel-deploy`). Routes in `src/router/index.ts`.

## Conventions

- **Lazy-load route components** for code-splitting: `component: () => import('@/views/RoomView.vue')`. Landing view may be eager; the rest lazy.
- **Named routes**; navigate by name + params, never hardcoded paths: `router.push({ name: 'room', params: { code } })`.
- **Typed routes**: type route names/params (or `unplugin-vue-router` for generated types — optional).
- **Thin guards.** Guards decide *access* and delegate to stores — no business logic/mutation in a guard. Use `meta`:
  ```ts
  { path: '/room/:code', name: 'room', component: () => import('@/views/RoomView.vue'), meta: { requiresIdentity: true } }
  router.beforeEach((to) => {
    if (to.meta.requiresIdentity && !useIdentityStore().deviceUuid) return { name: 'home' }
  })
  ```
- **Scroll behavior**: reset to top on navigation.
- **404**: catch-all `not-found` route.
- Data loading in components/stores (or `onBeforeRouteEnter` sparingly) — not in global guards. The room subscription belongs to the room store, started when the view mounts, not in a guard.

## Accessibility on navigation (see `a11y-mobile`)

SPA route changes are silent to screen readers. On navigation, move focus to the main heading / `<main>` and announce the new view via a polite live region.

## Structure

- `src/router/index.ts` — routes + guards. `src/views/` — lazy route components. `App.vue` = thin shell around a keyed `<RouterView>` + persistent chrome (the sticky header: Back, the room code, the local-game badge and the menu; the update banner; live regions).

## Testing

- Guard logic as pure functions → unit-test (see `tdd`). E2E covers real navigation (incl. join → room).

## This project (card-scorekeeper)

Routes: `/` (`home`, eager — join or new game), `/room/:code` (`room`, the game; `/room/local` is a local game), `/join/:code` (`join`, the invite link: asks for a name), `/rules`, `/stats` (this device's stats), `/highscores` (global lists), `/privacy` (Tietosuoja), and the catch-all `not-found`. Each has `meta.announceKey` for the navigation announcement. The only guard is the identity check: `room`, `join` and `stats` have `meta.requiresIdentity` and redirect home when there's no device identity. An unknown or finished room is handled inside `RoomView` (its empty state), not in a guard. **Routing must work offline** — the SPA shell is cached (`pwa`), so client routes resolve with no network; an offline local game still lives under a room route (`/room/local`, `LOCAL_GAME_ROUTE_CODE`). Don't put backend calls in guards — offline navigation must not block on the network.

**Back and leaving a game.** The header's Back (`BackButton.vue`, hidden on Home) goes to the previous screen when this tab has one (`hasInAppBack(router.options.history.state)` in `lib/platform/navigation.ts`: web history records `back`, null on a directly opened page) and otherwise goes Home, so Back never leaves the app. Leaving a room never ends its game: Home's "Game in progress" card offers the store's running game, the last online room (`lib/data/last-room.ts`, forgotten on finish or losing the seat, ignored after the room TTL) and an unfinished local game. A new local game asks before replacing an unfinished one.
