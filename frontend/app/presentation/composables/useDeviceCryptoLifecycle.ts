import { onBeforeUnmount, onMounted, reactive, readonly, watch, type ComputedRef } from 'vue'

import type { CurrentAccount } from '../../domain/accounts/account'
import { ApplicationError } from '../../application/errors'
import { DeviceCryptoError, type DeviceCryptoErrorCode } from '../../application/device-crypto/errors'
import type { DeviceCryptoIdentityCommand } from '../../application/ports/device-crypto-gateway'

export type DeviceCryptoLifecycleIssue =
  | DeviceCryptoErrorCode
  | 'network'
  | 'server'
  | 'unknown'

interface DeviceCryptoLifecycleState {
  status: 'idle' | 'initializing' | 'ready' | 'unavailable'
  issue: DeviceCryptoLifecycleIssue | null
}

export interface DeviceCryptoLifecycleSession {
  initialize(command: DeviceCryptoIdentityCommand): Promise<unknown>
  dispose(): Promise<void>
}

export async function synchronizeDeviceCryptoSession(
  session: DeviceCryptoLifecycleSession,
  current: CurrentAccount | null,
): Promise<void> {
  if (!current) {
    await session.dispose()
    return
  }
  await session.initialize({
    userId: current.userId,
    deviceId: current.deviceId,
  })
}

export function deviceCryptoIssueMessage(issue: DeviceCryptoLifecycleIssue | null): string {
  if (issue === 'not-provisioned') {
    return 'Локальные ключи этого входа отсутствуют. Переподключите устройство.'
  }
  if (issue === 'local-state-lost') {
    return 'Локальные ключи защищённых чатов потеряны. Требуется безопасно переподключить устройство.'
  }
  if (issue === 'conflict' || issue === 'corrupt-state' || issue === 'rollback') {
    return 'Локальные ключи не совпадают с регистрацией устройства. Переподключите его.'
  }
  if (issue === 'invalid-key-package') {
    return 'Проверка ключевого пакета устройства не прошла. Переподключите устройство.'
  }
  if (issue === 'storage-unavailable') {
    return 'Браузер не дал доступ к защищённому локальному хранилищу.'
  }
  if (issue === 'runtime-unavailable') {
    return 'Не загрузился локальный OpenMLS-модуль. Проверьте сеть и обновите приложение.'
  }
  if (issue === 'runtime-import-failed') {
    return 'Не загрузился файл OpenMLS. Полностью закройте PWA и откройте её снова.'
  }
  if (issue === 'runtime-invalid-module') {
    return 'Версии OpenMLS JS и WASM не совпали. Обновите установленное приложение.'
  }
  if (issue === 'runtime-init-failed') {
    return 'Браузер не смог запустить OpenMLS WebAssembly. Обновите браузер и приложение.'
  }
  if (issue === 'worker-timeout') {
    return 'OpenMLS Worker не ответил вовремя. Полностью перезапустите приложение.'
  }
  if (issue === 'worker-failed' || issue === 'worker-protocol') {
    return 'OpenMLS Worker аварийно остановился. Полностью перезапустите приложение.'
  }
  if (issue === 'network') return 'Не удалось проверить ключи из-за потери соединения.'
  if (issue === 'server') return 'Сервер временно не смог проверить регистрацию устройства.'
  return 'Криптомодуль этого устройства не готов. Защищённые функции отключены.'
}

export function deviceCryptoIssueNeedsReconnect(
  issue: DeviceCryptoLifecycleIssue | null,
): boolean {
  return issue === 'not-provisioned'
    || issue === 'local-state-lost'
    || issue === 'conflict'
    || issue === 'corrupt-state'
    || issue === 'rollback'
    || issue === 'invalid-key-package'
}

function issueFrom(error: unknown): DeviceCryptoLifecycleIssue {
  if (error instanceof DeviceCryptoError) return error.code
  if (error instanceof ApplicationError) {
    if (error.kind === 'network') return 'network'
    return error.status !== null && error.status >= 500 ? 'server' : 'unknown'
  }
  return 'unknown'
}

export function useDeviceCryptoLifecycle(user: ComputedRef<CurrentAccount | null>) {
  const { $frontend } = useNuxtApp()
  const state = reactive<DeviceCryptoLifecycleState>({ status: 'idle', issue: null })
  let generation = 0
  let stopWatching: (() => void) | null = null

  async function initialize(): Promise<void> {
    const current = user.value
    const operation = ++generation
    if (!current) {
      try {
        await synchronizeDeviceCryptoSession($frontend.deviceCryptoSession, null)
      } catch {
        // Logout/unmount still clears the shared session reference even if a
        // failed Worker cannot acknowledge disposal.
      }
      state.status = 'idle'
      state.issue = null
      return
    }
    state.status = 'initializing'
    state.issue = null
    try {
      await synchronizeDeviceCryptoSession($frontend.deviceCryptoSession, current)
      if (operation === generation) {
        state.status = 'ready'
        state.issue = null
        void $frontend.linkedDeviceEnrollment
          .reconcileCurrentRoster(current.userId)
          .then(() => $frontend.deviceHistorySync.start(current.userId, current.deviceId))
          .catch(() => undefined)
      }
    } catch (error) {
      if (operation === generation) {
        state.status = 'unavailable'
        state.issue = issueFrom(error)
      }
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
    $frontend.linkedDeviceEnrollment.cancelAll()
    $frontend.deviceHistorySync.stop()
    void $frontend.deviceCryptoSession.dispose()
  })

  return { state: readonly(state), retry: initialize }
}
