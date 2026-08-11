import { computed, onBeforeUnmount, onMounted } from 'vue'

import type { ThemePreference } from '../../domain/preferences/theme'

export function usePreferences() {
  const { $frontend } = useNuxtApp()
  const theme = useState<ThemePreference>('theme-preference', () => $frontend.themePreferences.load())
  const hapticsEnabled = useState<boolean>('haptics-enabled', () => $frontend.haptics.isEnabled())
  let unsubscribe: (() => void) | null = null

  function applyTheme(preference: ThemePreference): void {
    theme.value = preference
    $frontend.themePreferences.apply(preference)
    $frontend.haptics.perform('selection')
  }

  function setHaptics(enabled: boolean): void {
    hapticsEnabled.value = enabled
    $frontend.haptics.setEnabled(enabled)
    if (enabled) $frontend.haptics.perform('success')
  }

  onMounted(() => {
    $frontend.themePreferences.apply(theme.value)
    unsubscribe = $frontend.themePreferences.subscribeSystemChange(() => {
      if (theme.value === 'system') $frontend.themePreferences.apply('system')
    })
  })
  onBeforeUnmount(() => unsubscribe?.())

  return {
    theme: computed(() => theme.value),
    hapticsEnabled: computed(() => hapticsEnabled.value),
    applyTheme,
    setHaptics,
  }
}
