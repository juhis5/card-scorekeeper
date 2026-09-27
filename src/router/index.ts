import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import { useIdentityStore } from '@/stores/identity'

/** Every view's `<h1>` has this id, so focus can move there after navigation. */
const MAIN_HEADING_ID = 'main-heading'

declare module 'vue-router' {
  interface RouteMeta {
    /** Redirect home until this device has an identity (main.ts assigns one at startup). */
    requiresIdentity?: boolean
    /** i18n key for this route's heading, announced via a polite live region on navigation. */
    announceKey?:
      | 'home.heading'
      | 'room.heading'
      | 'join.announce'
      | 'rules.heading'
      | 'stats.heading'
      | 'notFound.heading'
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
      path: '/join/:code',
      name: 'join',
      component: () => import('@/views/JoinView.vue'),
      meta: { requiresIdentity: true, announceKey: 'join.announce' },
    },
    {
      path: '/rules',
      name: 'rules',
      component: () => import('@/views/RulesView.vue'),
      meta: { announceKey: 'rules.heading' },
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('@/views/StatsView.vue'),
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

router.beforeEach((to) => {
  if (to.meta.requiresIdentity && !useIdentityStore().deviceUuid) {
    return { name: 'home' }
  }
})

// SPA navigation is silent to screen readers: focus the new heading. App.vue's live region
// announces it too.
router.afterEach(() => {
  nextTick(() => {
    document.getElementById(MAIN_HEADING_ID)?.focus()
  })
})

export default router
