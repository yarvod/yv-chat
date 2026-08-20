import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import LoginDevicePairing from '../app/components/auth/LoginDevicePairing.vue'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('login device pairing flow', () => {
  it('lets an unauthenticated phone consume a computer offer and receive its own session', async () => {
    vi.useFakeTimers()
    const states = new Map<string, ReturnType<typeof ref>>()
    vi.stubGlobal('useState', (key: string, factory: () => unknown) => {
      let state = states.get(key)
      if (!state) {
        state = ref(factory())
        states.set(key, state)
      }
      return state
    })
    states.set('auth-session', ref({ phase: 'signed-out', user: null, message: null }))
    states.set('auth-initialized', ref(true))
    const pending = {
      pairingId: 'pairing-offer',
      protocolVersion: 1,
      purpose: 'enrollment_offer',
      status: 'confirmation_pending',
      candidateDeviceName: 'Safari · iOS · Телефон',
      trustedDeviceName: 'Chrome · Windows · Компьютер',
      accountDisplayName: 'Alice',
      authenticationCode: '654321',
      expiresAt: '2099-08-13T18:10:00Z',
      authorizedDeviceId: null,
      trustedDeviceId: 'computer-device',
      candidateDeviceId: null,
    } as const
    const approved = { ...pending, status: 'approved' as const }
    const account = {
      userId: 'alice-user',
      deviceId: 'phone-device',
      username: 'alice',
      displayName: 'Alice',
      isAdmin: false,
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-20T00:00:00Z',
    }
    const scan = vi.fn().mockResolvedValue(pending)
    const candidateStatus = vi.fn().mockResolvedValue(approved)
    const authorize = vi.fn().mockResolvedValue({
      account,
      pairing: { ...approved, status: 'authorized' as const, authorizedDeviceId: 'phone-device' },
    })
    const queue = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceInfo: { current: () => ({ deviceClass: 'mobile' }) },
        devicePairing: { scan, candidateStatus, authorize, cancelCandidate: vi.fn() },
        deviceHistorySync: { queue },
      },
    }))
    const wrapper = mount(LoginDevicePairing, {
      global: {
        stubs: {
          QrcodeVue: { template: '<div />' },
          DeviceQrScanner: {
            emits: ['decoded', 'cancel'],
            template: '<button class="decode" @click="$emit(\'decoded\', \'cross-origin-offer\')">decode</button>',
          },
        },
      },
    })

    await wrapper.get('button').trigger('click')
    await wrapper.get('.decode').trigger('click')
    await flushPromises()
    expect(scan).toHaveBeenCalledWith('cross-origin-offer', false)
    expect(wrapper.text()).toContain('654321')

    await vi.advanceTimersByTimeAsync(1_400)
    await flushPromises()
    expect(candidateStatus).toHaveBeenCalledWith('pairing-offer')
    expect(authorize).toHaveBeenCalledWith('pairing-offer')
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      currentDeviceId: 'phone-device',
      targetDeviceId: 'computer-device',
      prepareTarget: true,
    }))
    expect(wrapper.emitted('authorized')).toHaveLength(1)
    wrapper.unmount()
  })
})
