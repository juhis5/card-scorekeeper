import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import { useIdentityStore } from '@/stores/identity'

/** Every route's `<h1>` carries this id so focus can move there after navigation (a11y-mobile). */
const MAIN_HEADING_ID = 'main-heading'

declare module 'vue-router' {
  interface RouteMeta {
    /** Redirect home when no device identity exists yet — set by useIdentityStore in main.ts. */
    requiresIdentity?: boolean
    /** i18n key for this route's heading, announced via a polite live region on navigation. */
    announceKey?:
      'home.heading' | 'room.heading' | 'join.announce' | 'stats.heading' | 'notFound.heading'
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior() {
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { announceKey: 'home.heading' },
    },
    {
      path: '/room/:code',
      name: 'room',
      component: () => import('@/views/RoomView.vue'),
      meta: { requiresIdentity: true, announceKey: 'room.heading' },
    },
    {
      // The page an invite link or QR code opens: the code is filled in, only a name is asked.
      path: '/join/:code',
      name: 'join',
      component: () => import('@/views/JoinView.vue'),
      meta: { requiresIdentity: true, announceKey: 'join.announce' },
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('@/views/StatsView.vue'),
      // Guards on the identity store's deviceUuid, same as /room — belt-and-suspenders: main.ts
      // already assigns it before the router's first navigation, and useStatsStore itself keys
      // on the separate Firebase Anonymous Auth uid (see its doc comment), not this deviceUuid.
      meta: { requiresIdentity: true, announceKey: 'stats.heading' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { announceKey: 'notFound.heading' },
    },
  ],
})

// Thin guard: decides access only, delegates the "do we have an identity" question to the
// identity store — no business logic or mutation here (see the routing skill).
router.beforeEach((to) => {
  if (to.meta.requiresIdentity && !useIdentityStore().deviceUuid) {
    return { name: 'home' }
  }
})

// SPA navigations are silent to screen readers. Move focus to the new view's heading so it
// gets announced; App.vue's live region (keyed off `meta.announceKey`) announces the same text
// for anyone not tracking focus.
router.afterEach(() => {
  nextTick(() => {
    document.getElementById(MAIN_HEADING_ID)?.focus()
  })
})

export default router
