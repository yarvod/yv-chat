import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import DevicePairingCard from '../app/components/settings/DevicePairingCard.vue'
import type { LinkedDeviceEnrollmentProgress } from '../app/application/device-crypto/enroll-linked-device'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('device pairing settings flow', () => {
  it('starts MLS enrollment after the candidate receives its independent session', async () => {
    vi.useFakeTimers()
    const user = {
      userId: 'alice-user',
      deviceId: 'trusted-device',
      username: 'alice',
      displayName: 'Alice',
      role: 'user',
      deviceDisplayName: 'Mac · Компьютер',
    }
    const states = new Map<string, ReturnType<typeof ref>>()
    vi.stubGlobal('useState', (key: string, factory: () => unknown) => {
      let state = states.get(key)
      if (!state) {
        state = ref(factory())
        states.set(key, state)
      }
      return state
    })
    const enroll = vi.fn(async (
      _owner: string,
      _target: string,
      onProgress: (progress: LinkedDeviceEnrollmentProgress) => void,
    ) => {
      const progress: LinkedDeviceEnrollmentProgress = {
        targetDeviceId: 'candidate-device',
        totalConversations: 2,
        readyConversations: 2,
        pendingConversationIds: [],
        complete: true,
      }
      onProgress(progress)
      return progress
    })
    const createOffer = vi.fn().mockResolvedValue({
      created: {
        pairingId: 'pairing-id',
        protocolVersion: 1,
        purpose: 'enrollment_offer',
        scanToken: 'scan-token',
        expiresAt: '2099-08-13T18:10:00Z',
      },
      qrValue: '{"pairing":"offer"}',
    })
    const trustedStatus = vi.fn().mockResolvedValue({
      pairingId: 'pairing-id',
      protocolVersion: 1,
      purpose: 'enrollment_offer',
      status: 'authorized',
      candidateDeviceName: 'New phone',
      trustedDeviceName: 'Mac',
      accountDisplayName: 'Alice',
      authenticationCode: '123456',
      expiresAt: '2099-08-13T18:10:00Z',
      authorizedDeviceId: 'candidate-device',
    })
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceInfo: { current: () => ({ deviceClass: 'desktop' }) },
        devicePairing: {
          createOffer,
          trustedStatus,
          cancelTrusted: vi.fn(),
        },
        linkedDeviceEnrollment: { enroll },
      },
    }))
    states.set('auth-session', ref({ phase: 'authenticated', user, message: null }))
    states.set('auth-initialized', ref(true))
    const wrapper = mount(DevicePairingCard, {
      global: {
        stubs: {
          QrcodeVue: { template: '<div class="qr-stub" />' },
          DeviceQrScanner: { template: '<div />' },
        },
      },
    })

    await wrapper.get('button').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1_400)
    await flushPromises()

    expect(trustedStatus).toHaveBeenCalledWith('pairing-id')
    expect(enroll).toHaveBeenCalledWith('alice-user', 'candidate-device', expect.any(Function))
    expect(wrapper.text()).toContain('Устройство подключено к 2 защищённым чатам')
  })
})
