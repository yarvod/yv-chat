export default defineNuxtPlugin(nuxtApp => {
  const root = document.documentElement
  const viewport = window.visualViewport
  let frame: number | null = null

  const apply = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = null
      const height = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      root.style.setProperty('--app-viewport-height', `${Math.round(height)}px`)
      root.style.setProperty('--app-viewport-offset-top', `${Math.max(0, Math.round(offsetTop))}px`)
    })
  }

  apply()
  viewport?.addEventListener('resize', apply)
  viewport?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  nuxtApp.vueApp.onUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', apply)
    viewport?.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    root.style.removeProperty('--app-viewport-height')
    root.style.removeProperty('--app-viewport-offset-top')
  })
})
