import { computed, readonly } from 'vue'

import { ApplicationError } from '../../application/errors'
import type { LoginCommand } from '../../application/auth/login'
import {
  isTransientSessionBootstrapError,
  restoreCurrentAccount,
} from '../../application/auth/restore-current-account'
import type { CurrentAccount } from '../../domain/accounts/account'

export type AuthPhase = 'booting' | 'signed-out' | 'submitting' | 'authenticated' | 'offline'

export interface AuthState {
  phase: AuthPhase
  user: CurrentAccount | null
  message: string | null
}

export function useAuth() {
  const { $frontend } = useNuxtApp()
  const offlineAccountStore = $frontend.offlineAccountStore
  const state = useState<AuthState>('auth-session', () => ({
    phase: 'booting',
    user: null,
    message: null,
  }))
  const initialized = useState<boolean>('auth-initialized', () => false)

  async function cacheAccount(account: CurrentAccount): Promise<void> {
    try {
      await offlineAccountStore?.save(account)
    } catch {
      offlineAccountStore?.close()
    }
  }

  async function clearCachedAccount(): Promise<void> {
    try {
      await offlineAccountStore?.clear()
    } catch {
      offlineAccountStore?.close()
    }
  }

  async function loadCachedAccount(): Promise<CurrentAccount | null> {
    try {
      return await offlineAccountStore?.load() ?? null
    } catch {
      offlineAccountStore?.close()
      return null
    }
  }

  function fail(error: unknown, loginAttempt = false): void {
    initialized.value = true
    if (error instanceof ApplicationError && error.status === 401) {
      void clearCachedAccount()
      state.value.user = null
      state.value.phase = 'signed-out'
      state.value.message = loginAttempt ? 'Неверное имя пользователя или пароль.' : null
      return
    }
    if (!loginAttempt && isTransientSessionBootstrapError(error)) {
      state.value.phase = state.value.user === null ? 'offline' : 'authenticated'
      state.value.message = 'Сервер временно недоступен. Текущая сессия сохранена.'
      return
    }
    state.value.user = null
    state.value.phase = 'signed-out'
    state.value.message = loginAttempt
      ? 'Не удалось выполнить вход. Повторите попытку.'
      : 'Не удалось проверить сессию. Обновите страницу.'
  }

  async function bootstrap(force = false): Promise<void> {
    if (!force && initialized.value) return
    state.value.phase = 'booting'
    state.value.message = null
    const cached = await loadCachedAccount()
    if (cached) {
      state.value.user = cached
      state.value.phase = 'offline'
      state.value.message = 'Открыта локальная история. Проверяем соединение с сервером.'
      initialized.value = true
      void verifyCachedAccount(cached)
      return
    }
    try {
      const account = await restoreCurrentAccount(
        () => $frontend.loadCurrentAccount.execute(),
        delayMs => new Promise(resolve => window.setTimeout(resolve, delayMs)),
      )
      state.value.user = account
      state.value.phase = 'authenticated'
      initialized.value = true
      await cacheAccount(account)
    } catch (error) {
      if (isTransientSessionBootstrapError(error)) {
        const cached = await loadCachedAccount()
        initialized.value = true
        state.value.user = cached
        state.value.phase = 'offline'
        state.value.message = cached
          ? 'Сервер недоступен. Открыта локальная история этого устройства.'
          : 'Сервер временно недоступен. Текущую сессию пока нельзя проверить.'
        return
      }
      if (error instanceof ApplicationError && error.status === 401) {
        await clearCachedAccount()
      }
      fail(error)
    }
  }

  async function verifyCachedAccount(cached: CurrentAccount): Promise<void> {
    try {
      const account = await restoreCurrentAccount(
        () => $frontend.loadCurrentAccount.execute(),
        delayMs => new Promise(resolve => window.setTimeout(resolve, delayMs)),
      )
      if (state.value.user?.deviceId !== cached.deviceId) return
      state.value.user = account
      state.value.phase = 'authenticated'
      state.value.message = null
      await cacheAccount(account)
    } catch (error) {
      if (state.value.user?.deviceId !== cached.deviceId) return
      if (error instanceof ApplicationError && error.status === 401) {
        await clearCachedAccount()
        fail(error)
        await navigateTo('/login')
        return
      }
      state.value.phase = 'offline'
      state.value.message = isTransientSessionBootstrapError(error)
        ? 'Сервер недоступен. Открыта локальная история этого устройства.'
        : 'Не удалось проверить сессию. Доступна только локальная история.'
    }
  }

  async function login(command: LoginCommand): Promise<boolean> {
    state.value.phase = 'submitting'
    state.value.message = null
    try {
      const account = await $frontend.login.execute(command)
      state.value.user = account
      state.value.phase = 'authenticated'
      initialized.value = true
      await cacheAccount(account)
      return true
    } catch (error) {
      fail(error, true)
      return false
    }
  }

  async function logout(): Promise<void> {
    await $frontend.logout.execute()
    await clearCachedAccount()
    state.value = { phase: 'signed-out', user: null, message: null }
    initialized.value = true
  }

  function sessionExpired(): void {
    void clearCachedAccount()
    state.value = { phase: 'signed-out', user: null, message: 'Сессия завершена.' }
    initialized.value = true
  }

  function replaceCurrentUser(user: CurrentAccount): void {
    state.value = { phase: 'authenticated', user, message: null }
    initialized.value = true
    void cacheAccount(user)
  }

  async function enrollReplacementDevice(password: string): Promise<boolean> {
    const current = state.value.user
    if (!current) return false
    const replacement = await $frontend.login.execute({
      username: current.username,
      password,
    })
    replaceCurrentUser(replacement)
    return true
  }

  function securityResetCompleted(): void {
    void clearCachedAccount()
    state.value = {
      phase: 'signed-out',
      user: null,
      message: 'Все сеансы завершены. Войдите снова.',
    }
    initialized.value = true
  }

  return {
    state: readonly(state),
    user: computed(() => state.value.user),
    isAuthenticated: computed(() => (
      state.value.user !== null
      && (state.value.phase === 'authenticated' || state.value.phase === 'offline')
    )),
    bootstrap,
    login,
    logout,
    sessionExpired,
    replaceCurrentUser,
    enrollReplacementDevice,
    securityResetCompleted,
  }
}
