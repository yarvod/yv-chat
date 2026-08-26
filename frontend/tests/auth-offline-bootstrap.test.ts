import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { ApplicationError } from '../app/application/errors'
import { useAuth } from '../app/presentation/composables/useAuth'

const account = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
  deviceId: '1a166081-37d5-40ea-8238-3f639e7be090',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(loadCurrent: () => Promise<typeof account>, cached: typeof account | null) {
  const states = new Map<string, ReturnType<typeof ref>>()
  vi.stubGlobal('useState', (key: string, factory: () => unknown) => {
    let state = states.get(key)
    if (!state) {
      state = ref(factory())
      states.set(key, state)
    }
    return state
  })
  const save = vi.fn().mockResolvedValue(undefined)
  const clear = vi.fn().mockResolvedValue(undefined)
  const load = vi.fn().mockResolvedValue(cached)
  vi.stubGlobal('navigateTo', vi.fn().mockResolvedValue(undefined))
  vi.stubGlobal('useNuxtApp', () => ({
    $frontend: {
      loadCurrentAccount: { execute: loadCurrent },
      offlineAccountStore: { save, clear, load, close: vi.fn() },
    },
  }))
  return { save, clear, load }
}

async function bootstrapWithRetries(auth: ReturnType<typeof useAuth>): Promise<void> {
  const operation = auth.bootstrap()
  await vi.runAllTimersAsync()
  await operation
}

describe('offline auth bootstrap', () => {
  it('opens the local authenticated shell after a cold network failure', async () => {
    vi.useFakeTimers()
    const loadCurrent = vi.fn().mockRejectedValue(
      new ApplicationError(null, 'network', 'offline'),
    )
    const store = setup(loadCurrent, account)
    const auth = useAuth()

    await bootstrapWithRetries(auth)

    expect(store.load).toHaveBeenCalledOnce()
    expect(auth.state.value.phase).toBe('offline')
    expect(auth.user.value).toEqual(account)
    expect(auth.isAuthenticated.value).toBe(true)
    expect(auth.state.value.message).toContain('локальная история')
  })

  it('does not invent an authenticated user when no local account exists', async () => {
    vi.useFakeTimers()
    const loadCurrent = vi.fn().mockRejectedValue(
      new ApplicationError(null, 'network', 'offline'),
    )
    setup(loadCurrent, null)
    const auth = useAuth()

    await bootstrapWithRetries(auth)

    expect(auth.state.value.phase).toBe('offline')
    expect(auth.user.value).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
  })

  it('clears the cached projection and stays signed out after authoritative 401', async () => {
    const unauthorized = new ApplicationError(401, 'http', 'unauthorized')
    const loadCurrent = vi.fn().mockRejectedValue(unauthorized)
    const store = setup(loadCurrent, account)
    const auth = useAuth()

    await auth.bootstrap()

    await vi.waitFor(() => expect(store.clear).toHaveBeenCalled())

    expect(store.load).toHaveBeenCalledOnce()
    expect(store.clear).toHaveBeenCalled()
    expect(auth.state.value.phase).toBe('signed-out')
    expect(auth.user.value).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
  })

  it('refreshes the encrypted projection after online bootstrap', async () => {
    const loadCurrent = vi.fn().mockResolvedValue(account)
    const store = setup(loadCurrent, null)
    const auth = useAuth()

    await auth.bootstrap()

    expect(store.save).toHaveBeenCalledWith(account)
    expect(auth.state.value.phase).toBe('authenticated')
    expect(auth.isAuthenticated.value).toBe(true)
  })
})
