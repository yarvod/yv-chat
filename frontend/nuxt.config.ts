export default defineNuxtConfig({
  compatibilityDate: '2026-08-11',
  ssr: false,
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
      theme_color: '#7057ff',
      background_color: '#0b0d13',
      display: 'standalone',
      orientation: 'any',
    },
    workbox: {
      navigateFallback: '/',
      globPatterns: ['**/*.{css,html,ico,js,png,svg,wasm,webmanifest}'],
    },
  },
})
