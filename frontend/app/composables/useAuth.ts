import { reactive, readonly } from 'vue'

import { ApiError } from '../services/api'
import { authService, type LoginInput } from '../services/auth'
import type { CurrentAccount } from '../services/parsers'

type AuthPhase = 'booting' | 'signed-out' | 'submitting' | 'authenticated' | 'offline'

interface AuthState {
  phase: AuthPhase
  user: CurrentAccount | null
  message: string | null
}

const state = reactive<AuthState>({ phase: 'booting', user: null, message: null })

function fail(error: unknown, loginAttempt = false): void {
  state.user = null
  if (error instanceof ApiError && error.status === 401) {
    state.phase = 'signed-out'
    state.message = loginAttempt ? 'Неверное имя пользователя или пароль.' : 'Сессия завершена.'
    return
  }
  state.phase = 'offline'
  state.message = 'Сервер недоступен. Проверьте соединение и повторите попытку.'
}

export function useAuth() {
  return {
    state: readonly(state),
    async bootstrap(): Promise<void> {
      state.phase = 'booting'
      state.message = null
      try {
        state.user = await authService.current()
        state.phase = 'authenticated'
      } catch (error) {
        fail(error)
      }
    },
    async login(input: LoginInput): Promise<void> {
      state.phase = 'submitting'
      state.message = null
      try {
        state.user = await authService.login(input)
        state.phase = 'authenticated'
      } catch (error) {
        fail(error, true)
      }
    },
    async logout(): Promise<void> {
      try {
        await authService.logout()
      } catch (error) {
        if (!(error instanceof ApiError && error.kind === 'network')) throw error
      } finally {
        state.user = null
        state.phase = 'signed-out'
        state.message = null
      }
    },
  }
}
