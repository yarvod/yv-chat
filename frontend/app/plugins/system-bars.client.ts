import { applySystemBarColor } from '../infrastructure/browser/theme-preferences'

export default defineNuxtPlugin(nuxtApp => {
  const apply = () => applySystemBarColor(
    document,
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const observer = new MutationObserver(apply)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  observer.observe(document.head, {
    attributes: true,
    attributeFilter: ['content'],
    childList: true,
    subtree: true,
  })
  requestAnimationFrame(apply)
  nuxtApp.vueApp.onUnmount(() => observer.disconnect())
})
