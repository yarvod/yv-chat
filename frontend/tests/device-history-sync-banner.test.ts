import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import DeviceHistorySyncBanner from '../app/components/ui/DeviceHistorySyncBanner.vue'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('device history sync banner', () => {
  it('lets the user dismiss a completed sync without cancelling it', async () => {
    const states = new Map<string, ReturnType<typeof ref>>()
    vi.stubGlobal('useState', (key: string, factory: () => unknown) => {
      let state = states.get(key)
      if (!state) {
        state = ref(factory())
        states.set(key, state)
      }
      return state
    })
    const progress = {
      ownerUserId: 'alice-user',
      currentDeviceId: 'phone-device',
      pairingId: 'pairing-id',
      targetDeviceId: 'desktop-device',
      stage: 'complete' as const,
      totalConversations: 3,
      readyConversations: 3,
      confirmedConversations: 3,
      skippedConversations: 0,
      exportedRecords: 12,
      importedRecords: 4,
      importRevision: 1,
      gaps: 0,
      complete: true,
      failure: null,
      importedConversationIds: ['conversation-id'],
      skippedConversationIds: [],
    }
    let current = [progress]
    const dismiss = vi.fn(() => { current = [] })
    const cancel = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceHistorySync: {
          current: () => current,
          subscribe: () => () => undefined,
          dismiss,
          cancel,
        },
      },
    }))
    states.set('auth-session', ref({
      phase: 'authenticated',
      user: {
        userId: 'alice-user',
        deviceId: 'phone-device',
        username: 'alice',
        displayName: 'Alice',
      },
      message: null,
    }))
    states.set('auth-initialized', ref(true))

    const wrapper = mount(DeviceHistorySyncBanner, {
      global: {
        stubs: { NuxtLink: { template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('История устройств синхронизирована')
    await wrapper.get('button[aria-label="Убрать уведомление о синхронизации"]').trigger('click')
    await flushPromises()

    expect(dismiss).toHaveBeenCalledWith('pairing-id')
    expect(cancel).not.toHaveBeenCalled()
    expect(wrapper.find('.device-history-sync-banner').exists()).toBe(false)
  })
})
