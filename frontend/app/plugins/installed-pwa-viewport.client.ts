interface StandaloneNavigator extends Navigator {
  readonly standalone?: boolean
}

export default defineNuxtPlugin(() => {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!viewport) return

  const baseViewport = viewport.content
  const lockedViewport = `${baseViewport}, maximum-scale=1, user-scalable=no`
  const displayMode = window.matchMedia('(display-mode: standalone)')
  const apply = (): void => {
    const iosStandalone = (navigator as StandaloneNavigator).standalone === true
    viewport.content = displayMode.matches || iosStandalone ? lockedViewport : baseViewport
  }

  apply()
  displayMode.addEventListener('change', apply)
})
