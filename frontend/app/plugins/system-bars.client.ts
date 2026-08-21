import { Capacitor } from '@capacitor/core'

import { applySystemBarColor } from '../infrastructure/browser/theme-preferences'
import { CapacitorSystemUi } from '../infrastructure/capacitor/capacitor-system-ui'

export default defineNuxtPlugin(nuxtApp => {
  const nativeSystemUi = Capacitor.isNativePlatform() ? new CapacitorSystemUi() : null
  const apply = () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    applySystemBarColor(document, theme)
    if (nativeSystemUi) void nativeSystemUi.applyTheme(theme).catch(() => undefined)
  }
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
  let removeKeyboardListeners: (() => void) | null = null
  if (nativeSystemUi) {
    void nativeSystemUi.subscribeKeyboard(document.documentElement).then(remove => {
      removeKeyboardListeners = remove
    }).catch(() => undefined)
  }
  nuxtApp.vueApp.onUnmount(() => {
    observer.disconnect()
    removeKeyboardListeners?.()
  })
})
