import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useIdentityStore } from './stores/identity'

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)

// Assign the per-device identity before the router's first navigation guard runs (it checks
// `deviceUuid` for `requiresIdentity` routes) — see the identity store and routing skill.
useIdentityStore().ensureDeviceUuid()

app.use(router)
app.use(i18n)

app.mount('#app')
