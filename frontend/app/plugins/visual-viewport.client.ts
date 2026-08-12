export default defineNuxtPlugin(nuxtApp => {
  const root = document.documentElement
  const viewport = window.visualViewport
  let frame: number | null = null

  const apply = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = null
      const height = viewport?.height ?? window.innerHeight
      root.style.setProperty('--app-viewport-height', `${Math.round(height)}px`)
    })
  }

  apply()
  viewport?.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  nuxtApp.vueApp.onUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    root.style.removeProperty('--app-viewport-height')
  })
})
