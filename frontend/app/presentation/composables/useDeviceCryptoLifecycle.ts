import { onBeforeUnmount, onMounted, reactive, readonly, watch, type ComputedRef } from 'vue'

import type { CurrentAccount } from '../../domain/accounts/account'

interface DeviceCryptoLifecycleState {
  status: 'idle' | 'initializing' | 'ready' | 'unavailable'
}

export function useDeviceCryptoLifecycle(user: ComputedRef<CurrentAccount | null>) {
  const { $frontend } = useNuxtApp()
  const state = reactive<DeviceCryptoLifecycleState>({ status: 'idle' })
  let scope: ReturnType<typeof $frontend.createDeviceCrypto> | null = null
  let generation = 0
  let stopWatching: (() => void) | null = null

  async function initialize(): Promise<void> {
    const current = user.value
    const operation = ++generation
    if (scope) {
      try {
        await scope.dispose()
      } catch {
        // A failed Worker is replaced below; no private state leaves its boundary.
      }
    }
    scope = null
    if (!current) {
      state.status = 'idle'
      return
    }
    state.status = 'initializing'
    try {
      const next = $frontend.createDeviceCrypto()
      scope = next
      await next.initialize.execute({
        userId: current.userId,
        deviceId: current.deviceId,
      })
      if (operation === generation) state.status = 'ready'
    } catch {
      if (operation === generation) state.status = 'unavailable'
    }
  }

  onMounted(() => {
    stopWatching = watch(
      () => user.value ? `${user.value.userId}:${user.value.deviceId}` : null,
      () => { void initialize() },
      { immediate: true },
    )
  })

  onBeforeUnmount(() => {
    generation += 1
    stopWatching?.()
    if (scope) void scope.dispose()
    scope = null
  })

  return { state: readonly(state), retry: initialize }
}
