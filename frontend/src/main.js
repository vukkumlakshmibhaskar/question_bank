import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/main.css'

import App from './App.vue'
import router from './router'
import { applyInitialThemePreference } from './stores/theme'
import { installFrontendTelemetry } from './services/telescopeClient'

applyInitialThemePreference()

const app = createApp(App)

app.use(createPinia())
app.use(router)
installFrontendTelemetry(app, router)

router.isReady().then(() => {
  app.mount('#app')
})
