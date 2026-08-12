export default defineNuxtPlugin(nuxtApp => {
  const root = document.documentElement
  const viewport = window.visualViewport
  let frame: number | null = null
  let keyboardReleaseTimer: number | null = null

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

  const isTextEntry = (target: EventTarget | null): boolean => {
    if (target instanceof HTMLTextAreaElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) return true
    if (!(target instanceof HTMLInputElement)) return false
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(target.type)
  }

  const handleFocusIn = (event: FocusEvent) => {
    if (!isTextEntry(event.target)) return
    if (keyboardReleaseTimer !== null) window.clearTimeout(keyboardReleaseTimer)
    keyboardReleaseTimer = null
    root.classList.add('app-keyboard-active')
  }

  const handleFocusOut = () => {
    if (keyboardReleaseTimer !== null) window.clearTimeout(keyboardReleaseTimer)
    keyboardReleaseTimer = window.setTimeout(() => {
      keyboardReleaseTimer = null
      if (isTextEntry(document.activeElement)) return
      root.classList.remove('app-keyboard-active')
    }, 0)
  }

  apply()
  viewport?.addEventListener('resize', apply)
  viewport?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
  nuxtApp.vueApp.onUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame)
    if (keyboardReleaseTimer !== null) window.clearTimeout(keyboardReleaseTimer)
    viewport?.removeEventListener('resize', apply)
    viewport?.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    document.removeEventListener('focusin', handleFocusIn)
    document.removeEventListener('focusout', handleFocusOut)
    root.classList.remove('app-keyboard-active')
    root.style.removeProperty('--app-viewport-height')
    root.style.removeProperty('--app-viewport-offset-top')
  })
})
