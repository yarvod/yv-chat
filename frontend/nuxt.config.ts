export default defineNuxtConfig({
  compatibilityDate: '2026-08-11',
  devtools: { enabled: false },
  modules: ['@nuxt/eslint', '@vite-pwa/nuxt'],
  css: ['~/assets/main.css'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  pwa: {
    registerType: 'prompt',
    manifest: {
      name: 'yv-chat',
      short_name: 'yv-chat',
      description: 'Private messenger for trusted groups',
      theme_color: '#10151f',
      background_color: '#10151f',
      display: 'standalone',
    },
    workbox: {
      navigateFallback: '/',
    },
  },
})

