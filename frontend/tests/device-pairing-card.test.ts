import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import DevicePairingCard from '../app/components/settings/DevicePairingCard.vue'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('device pairing settings flow', () => {
  it('restores durable progress after Settings remount and explains safe navigation', async () => {
    const user = {
      userId: 'alice-user', deviceId: 'phone-device', username: 'alice',
      displayName: 'Alice', role: 'user', deviceDisplayName: 'iPhone · Телефон',
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
    const current = vi.fn().mockReturnValue([{
      ownerUserId: 'alice-user',
      currentDeviceId: 'phone-device',
      pairingId: 'pairing-id',
      targetDeviceId: 'mac-device',
      stage: 'waiting_peer',
      totalConversations: 3,
      readyConversations: 3,
      confirmedConversations: 1,
      exportedRecords: 12,
      importedRecords: 4,
      importRevision: 1,
      gaps: 0,
      complete: false,
      failure: null,
      importedConversationIds: ['conversation-id'],
    }])
    const subscribe = vi.fn().mockReturnValue(() => undefined)
    const cancel = vi.fn().mockResolvedValue(undefined)
    const dismiss = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceInfo: { current: () => ({ deviceClass: 'mobile' }) },
        deviceHistorySync: { current, subscribe, cancel, dismiss },
      },
    }))
    states.set('auth-session', ref({ phase: 'authenticated', user, message: null }))
    states.set('auth-initialized', ref(true))
    const mountCard = () => mount(DevicePairingCard, {
      global: {
        stubs: {
          QrcodeVue: { template: '<div />' },
          DeviceQrScanner: { template: '<div />' },
        },
      },
    })

    const first = mountCard()
    await flushPromises()
    expect(first.text()).toContain('Ждём второе устройство')
    expect(first.text()).toContain('Синхронизировано: 1 из 3 чатов')
    expect(first.text()).toContain('Можно уйти из настроек')
    expect(first.text()).toContain('Остановить на обоих устройствах')
    await first.get('button').trigger('click')
    await flushPromises()
    expect(cancel).toHaveBeenCalledWith('pairing-id')
    first.unmount()

    const remounted = mountCard()
    await flushPromises()
    expect(remounted.text()).toContain('Ждём второе устройство')
    expect(current).toHaveBeenCalledTimes(3)
    remounted.unmount()
  })

  it('reports partial completion without calling skipped chats synchronized', async () => {
    const states = new Map<string, ReturnType<typeof ref>>()
    vi.stubGlobal('useState', (key: string, factory: () => unknown) => {
      let state = states.get(key)
      if (!state) {
        state = ref(factory())
        states.set(key, state)
      }
      return state
    })
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceInfo: { current: () => ({ deviceClass: 'mobile' }) },
        deviceHistorySync: {
          current: () => [{
            ownerUserId: 'alice-user',
            currentDeviceId: 'phone-device',
            pairingId: 'pairing-id',
            targetDeviceId: 'mac-device',
            stage: 'complete',
            totalConversations: 7,
            readyConversations: 5,
            confirmedConversations: 7,
            skippedConversations: 2,
            exportedRecords: 12,
            importedRecords: 4,
            importRevision: 1,
            gaps: 0,
            complete: true,
            failure: null,
            importedConversationIds: ['conversation-id'],
            skippedConversationIds: ['blocked-a', 'blocked-b'],
          }],
          subscribe: () => () => undefined,
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
        role: 'user',
        deviceDisplayName: 'iPhone · Телефон',
      },
      message: null,
    }))
    states.set('auth-initialized', ref(true))

    const wrapper = mount(DevicePairingCard, {
      global: {
        stubs: {
          QrcodeVue: { template: '<div />' },
          DeviceQrScanner: { template: '<div />' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Синхронизация завершена на обоих устройствах')
    expect(wrapper.text()).toContain('Синхронизировано: 5 из 7 чатов')
    expect(wrapper.text()).toContain('Пропущено: 2')
    expect(wrapper.text()).not.toContain('Остановить на обоих устройствах')
    wrapper.unmount()
  })

  it('queues durable MLS preparation after the candidate receives its independent session', async () => {
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
    const enroll = vi.fn()
    const queue = vi.fn()
    const resume = vi.fn()
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
      trustedDeviceId: 'trusted-device',
      candidateDeviceId: null,
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
        deviceHistorySync: {
          queue,
          resume,
          current: vi.fn().mockReturnValue([]),
          subscribe: vi.fn().mockReturnValue(() => undefined),
          synchronize: vi.fn().mockResolvedValue({
            exportedRecords: 2,
            importedRecords: 2,
            gaps: 0,
            complete: true,
          }),
        },
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
    await flushPromises()

    expect(trustedStatus).toHaveBeenCalledWith('pairing-id')
    expect(enroll).not.toHaveBeenCalled()
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      targetDeviceId: 'candidate-device',
      prepareTarget: true,
    }))
    expect(resume).toHaveBeenCalledWith('alice-user', 'trusted-device')
    expect(wrapper.text()).not.toContain('завершаем вход')
    expect(wrapper.text()).toContain('локальная история объединяется')
  })

  it('lets an authenticated phone approve an unauthenticated computer request', async () => {
    const user = {
      userId: 'alice-user',
      deviceId: 'phone-device',
      username: 'alice',
      displayName: 'Alice',
      role: 'user',
      deviceDisplayName: 'iPhone · Телефон',
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
    const pending = {
      pairingId: 'pairing-request',
      protocolVersion: 1,
      purpose: 'enrollment_request',
      status: 'confirmation_pending',
      candidateDeviceName: 'Chrome · Windows · Компьютер',
      trustedDeviceName: 'iPhone',
      accountDisplayName: 'Alice',
      authenticationCode: '123456',
      expiresAt: '2099-08-13T18:10:00Z',
      authorizedDeviceId: null,
      trustedDeviceId: 'phone-device',
      candidateDeviceId: null,
    } as const
    const scan = vi.fn().mockResolvedValue(pending)
    const approve = vi.fn().mockResolvedValue({ ...pending, status: 'approved' as const })
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceInfo: { current: () => ({ deviceClass: 'mobile' }) },
        devicePairing: {
          scan,
          approve,
          trustedStatus: vi.fn(),
          cancelTrusted: vi.fn(),
        },
        deviceHistorySync: {
          current: vi.fn().mockReturnValue([]),
          subscribe: vi.fn().mockReturnValue(() => undefined),
        },
      },
    }))
    states.set('auth-session', ref({ phase: 'authenticated', user, message: null }))
    states.set('auth-initialized', ref(true))
    const wrapper = mount(DevicePairingCard, {
      global: {
        stubs: {
          QrcodeVue: { template: '<div />' },
          DeviceQrScanner: {
            emits: ['decoded', 'cancel'],
            template: '<button class="decode" @click="$emit(\'decoded\', \'cross-origin-request\')">decode</button>',
          },
        },
      },
    })

    await wrapper.get('button').trigger('click')
    await wrapper.get('.decode').trigger('click')
    await flushPromises()
    expect(scan).toHaveBeenCalledWith('cross-origin-request', true)
    expect(wrapper.text()).toContain('Подтвердить компьютер')
    expect(wrapper.text()).toContain('123456')

    const confirm = wrapper.findAll('button').find(button => button.text() === 'Подтвердить компьютер')
    await confirm?.trigger('click')
    await flushPromises()
    expect(approve).toHaveBeenCalledWith('pairing-request')
    wrapper.unmount()
  })

  it('auto-selects existing-device sync and starts history union after computer approval', async () => {
    vi.useFakeTimers()
    const user = {
      userId: 'alice-user',
      deviceId: 'phone-device',
      username: 'alice',
      displayName: 'Alice',
      role: 'user',
      deviceDisplayName: 'iPhone · Телефон',
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
    const pending = {
      pairingId: 'pairing-id',
      protocolVersion: 1,
      purpose: 'enrollment_offer',
      status: 'confirmation_pending',
      candidateDeviceName: 'iPhone',
      trustedDeviceName: 'Mac',
      accountDisplayName: 'Alice',
      authenticationCode: '654321',
      expiresAt: '2099-08-13T18:10:00Z',
      authorizedDeviceId: null,
      trustedDeviceId: 'mac-device',
      candidateDeviceId: 'phone-device',
    } as const
    const authorized = {
      ...pending,
      status: 'authorized' as const,
      authorizedDeviceId: 'phone-device',
    }
    const scan = vi.fn().mockResolvedValue(pending)
    const existingCandidateStatus = vi.fn().mockResolvedValue(authorized)
    const queue = vi.fn()
    const enroll = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        deviceInfo: { current: () => ({ deviceClass: 'mobile' }) },
        devicePairing: {
          scan,
          existingCandidateStatus,
          cancelExistingCandidate: vi.fn(),
        },
        linkedDeviceEnrollment: { enroll },
        deviceHistorySync: {
          queue,
          resume: vi.fn(),
          current: vi.fn().mockReturnValue([]),
          subscribe: vi.fn().mockReturnValue(() => undefined),
        },
      },
    }))
    states.set('auth-session', ref({ phase: 'authenticated', user, message: null }))
    states.set('auth-initialized', ref(true))
    const wrapper = mount(DevicePairingCard, {
      global: {
        stubs: {
          QrcodeVue: { template: '<div />' },
          DeviceQrScanner: {
            emits: ['decoded', 'cancel'],
            template: '<button class="decode" @click="$emit(\'decoded\', \'qr-value\')">decode</button>',
          },
        },
      },
    })

    await wrapper.get('button').trigger('click')
    await wrapper.get('.decode').trigger('click')
    await flushPromises()
    expect(scan).toHaveBeenCalledWith('qr-value', true)
    expect(wrapper.text()).toContain('Ждём подтверждения на компьютере')
    expect(wrapper.text()).not.toContain('Подтвердить компьютер')

    await vi.advanceTimersByTimeAsync(1_400)
    await flushPromises()
    expect(existingCandidateStatus).toHaveBeenCalledWith('pairing-id')
    expect(enroll).not.toHaveBeenCalled()
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      currentDeviceId: 'phone-device',
      targetDeviceId: 'mac-device',
      pairingId: 'pairing-id',
    }))
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ prepareTarget: false }))
    expect(wrapper.text()).not.toContain('завершаем вход')
  })
})
