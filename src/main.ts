import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useIdentityStore } from './stores/identity'
import { useInstallStore } from './stores/install'
import { flushPendingResultsOnLaunch } from './lib/data/reconnect-flush'

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)

// Assign the per-device identity before the router's first navigation guard runs (it checks
// `deviceUuid` for `requiresIdentity` routes) — see the identity store and routing skill.
useIdentityStore().ensureDeviceUuid()
// Before mount: the browser's install prompt can fire before the menu is ever opened.
useInstallStore().listen(window)

app.use(router)
app.use(i18n)

app.mount('#app')

// Best-effort reconnect flush (see docs/PLAN.md "Reconnect = push final result only"): push any
// locally-queued finished-game results up to Firestore now that we're launching online. Never
// awaited — must never delay app mount (see the offline-capable host golden rule) — and any
// failure just leaves the queue for the next launch (see reconnect-flush.ts).
if (navigator.onLine) {
  void flushPendingResultsOnLaunch()
}
