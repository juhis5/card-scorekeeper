import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useIdentityStore } from './stores/identity'
import { useInstallStore } from './stores/install'
import { applyStoredTheme } from './composables/useTheme'
import { startErrorReporting } from './lib/platform/error-reporting'
import { flushPendingResultsOnLaunch } from './lib/data/reconnect-flush'

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)

// Before the router's first guard, which checks `deviceUuid` on `requiresIdentity` routes.
useIdentityStore().ensureDeviceUuid()
// Before mount: the browser's install prompt can fire before the menu is ever opened.
useInstallStore().listen(window)

app.use(router)
app.use(i18n)

app.mount('#app')
void startErrorReporting(app)
applyStoredTheme()

// Push results of games finished offline. Not awaited, so it never delays mount; a failure
// leaves them queued for the next launch.
if (navigator.onLine) {
  void flushPendingResultsOnLaunch()
}
