import { readonly } from 'vue'

import type { PushNotificationState } from '../../domain/notifications/push'

export function usePushNotifications() {
  const { $frontend } = useNuxtApp()
  const state = useState<PushNotificationState>('push-notifications', () => ({
    status: 'loading',
    busy: false,
    message: null,
  }))
  const initialized = useState<boolean>('push-notifications-initialized', () => false)

  async function inspect(force = false): Promise<void> {
    if (initialized.value && !force) return
    state.value = { status: 'loading', busy: true, message: null }
    state.value = await $frontend.pushNotifications.inspect()
    initialized.value = true
  }

  async function enable(): Promise<void> {
    if (state.value.busy) return
    state.value = { ...state.value, busy: true, message: null }
    state.value = await $frontend.pushNotifications.enable()
    initialized.value = true
    if (state.value.status === 'enabled') $frontend.haptics.perform('success')
  }

  async function disable(): Promise<void> {
    if (state.value.busy) return
    state.value = { ...state.value, busy: true, message: null }
    state.value = await $frontend.pushNotifications.disable()
    initialized.value = true
  }

  function promptDismissed(): boolean {
    return $frontend.pushNotifications.promptDismissed()
  }

  function dismissPrompt(): void {
    $frontend.pushNotifications.dismissPrompt()
  }

  return { state: readonly(state), inspect, enable, disable, promptDismissed, dismissPrompt }
}
