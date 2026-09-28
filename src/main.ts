import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useIdentityStore } from './stores/identity'
import { useInstallStore } from './stores/install'
import { useResultQueueStore } from './stores/result-queue'
import { applyStoredTheme } from './composables/useTheme'
import { startErrorReporting } from './lib/platform/error-reporting'

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
void startErrorReporting(app, router)
applyStoredTheme()

// Push results of games finished offline, now and whenever the browser comes back online. Not
// awaited, so it never delays mount; a failure leaves them queued.
const resultQueue = useResultQueueStore()
resultQueue.listen(window)
void resultQueue.upload()
