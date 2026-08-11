import { computed, readonly } from 'vue'

import { ApplicationError } from '../../application/errors'
import type { LoginCommand } from '../../application/auth/login'
import type { CurrentAccount } from '../../domain/accounts/account'

export type AuthPhase = 'booting' | 'signed-out' | 'submitting' | 'authenticated' | 'offline'

export interface AuthState {
  phase: AuthPhase
  user: CurrentAccount | null
  message: string | null
}

export function useAuth() {
  const { $frontend } = useNuxtApp()
  const state = useState<AuthState>('auth-session', () => ({
    phase: 'booting',
    user: null,
    message: null,
  }))
  const initialized = useState<boolean>('auth-initialized', () => false)

  function fail(error: unknown, loginAttempt = false): void {
    state.value.user = null
    initialized.value = true
    if (error instanceof ApplicationError && error.status === 401) {
      state.value.phase = 'signed-out'
      state.value.message = loginAttempt ? 'Неверное имя пользователя или пароль.' : null
      return
    }
    if (error instanceof ApplicationError && error.kind === 'network') {
      state.value.phase = 'offline'
      state.value.message = 'Сервер недоступен. Проверьте соединение и повторите попытку.'
      return
    }
    state.value.phase = 'signed-out'
    state.value.message = loginAttempt
      ? 'Не удалось выполнить вход. Повторите попытку.'
      : 'Не удалось проверить сессию. Обновите страницу.'
  }

  async function bootstrap(force = false): Promise<void> {
    if (!force && initialized.value) return
    state.value.phase = 'booting'
    state.value.message = null
    try {
      state.value.user = await $frontend.loadCurrentAccount.execute()
      state.value.phase = 'authenticated'
      initialized.value = true
    } catch (error) {
      fail(error)
    }
  }

  async function login(command: LoginCommand): Promise<boolean> {
    state.value.phase = 'submitting'
    state.value.message = null
    try {
      state.value.user = await $frontend.login.execute(command)
      state.value.phase = 'authenticated'
      initialized.value = true
      return true
    } catch (error) {
      fail(error, true)
      return false
    }
  }

  async function logout(): Promise<void> {
    await $frontend.logout.execute()
    state.value = { phase: 'signed-out', user: null, message: null }
    initialized.value = true
  }

  function sessionExpired(): void {
    state.value = { phase: 'signed-out', user: null, message: 'Сессия завершена.' }
    initialized.value = true
  }

  function replaceCurrentUser(user: CurrentAccount): void {
    state.value = { phase: 'authenticated', user, message: null }
    initialized.value = true
  }

  function securityResetCompleted(): void {
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
    isAuthenticated: computed(() => state.value.phase === 'authenticated' && state.value.user !== null),
    bootstrap,
    login,
    logout,
    sessionExpired,
    replaceCurrentUser,
    securityResetCompleted,
  }
}
