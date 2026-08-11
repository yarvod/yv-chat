import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DeviceSessionsCard from '../app/components/settings/DeviceSessionsCard.vue'
import PasswordSecurityCard from '../app/components/settings/PasswordSecurityCard.vue'
import { ApplicationError } from '../app/application/errors'
import {
  parseDeviceSessions,
  parseSecurityEvents,
} from '../app/infrastructure/http/account-security-parsers'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('security center', () => {
  it('parses bounded session/event DTOs and rejects malformed event types', () => {
    expect(parseDeviceSessions([{
      session_id: 'session-id',
      device_id: 'device-id',
      device_name: 'Safari · iOS',
      is_current: true,
      created_at: '2026-08-11T12:00:00Z',
      last_seen_at: '2026-08-11T12:01:00Z',
      idle_expires_at: '2026-09-11T12:00:00Z',
      absolute_expires_at: '2026-11-11T12:00:00Z',
      login_ip: null,
      last_ip: '203.0.113.5',
    }])[0]?.isCurrent).toBe(true)

    expect(() => parseSecurityEvents([{
      id: 'event-id',
      event_type: 'arbitrary_payload_event',
      created_at: '2026-08-11T12:00:00Z',
      actor_session_id: null,
      target_device_id: null,
    }])).toThrow(ApplicationError)
    expect(() => parseDeviceSessions([{ token_hash: 'secret' }])).toThrow(ApplicationError)
  })

  it('clears password fields before a pending password-change request resolves', async () => {
    let resolveChange: ((value: number) => void) | undefined
    const changePassword = vi.fn(() => new Promise<number>(resolve => {
      resolveChange = resolve
    }))
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        changePassword: { execute: changePassword },
        securityReset: { execute: vi.fn() },
      },
    }))
    const wrapper = mount(PasswordSecurityCard)
    await wrapper.get('input[name="current-password"]').setValue('old secret password')
    await wrapper.get('input[name="new-password"]').setValue('new secret password')
    await wrapper.get('input[name="password-confirmation"]').setValue('new secret password')
    await wrapper.findAll('form')[0]?.trigger('submit')

    expect(changePassword).toHaveBeenCalledWith('old secret password', 'new secret password')
    expect(wrapper.html()).not.toContain('old secret password')
    expect(wrapper.html()).not.toContain('new secret password')
    resolveChange?.(2)
    await flushPromises()
    expect(wrapper.text()).toContain('Завершено других сеансов: 2')
  })

  it('requires a second explicit submit before full security reset', async () => {
    const securityReset = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        changePassword: { execute: vi.fn() },
        securityReset: { execute: securityReset },
      },
    }))
    const wrapper = mount(PasswordSecurityCard)
    const resetForm = wrapper.findAll('form')[1]
    await resetForm?.get('input[name="reset-current-password"]').setValue('current secret')
    await resetForm?.trigger('submit')
    expect(securityReset).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Нажмите ещё раз')

    await resetForm?.trigger('submit')
    await flushPromises()
    expect(securityReset).toHaveBeenCalledWith('current secret')
    expect(wrapper.emitted('securityReset')).toHaveLength(1)
    expect(wrapper.html()).not.toContain('current secret')
  })

  it('never offers revoke for current device and confirms other-device revoke', async () => {
    const current = {
      sessionId: 'session-current', deviceId: 'device-current', deviceName: 'Current browser',
      isCurrent: true, createdAt: '2026-08-11T12:00:00Z', lastSeenAt: '2026-08-11T12:00:00Z',
      idleExpiresAt: '2026-09-11T12:00:00Z', absoluteExpiresAt: '2026-11-11T12:00:00Z',
      loginIp: null, lastIp: null,
    }
    const other = { ...current, sessionId: 'session-other', deviceId: 'device-other', deviceName: 'Old phone', isCurrent: false }
    const revokeDevice = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        listDeviceSessions: { execute: vi.fn().mockResolvedValue([current, other]) },
        renameDevice: { execute: vi.fn() },
        revokeDevice: { execute: revokeDevice },
        revokeOtherSessions: { execute: vi.fn() },
      },
    }))
    const wrapper = mount(DeviceSessionsCard)
    await flushPromises()

    expect(wrapper.text()).toContain('Current browser')
    expect(wrapper.findAll('button').filter(button => button.text() === 'Отозвать')).toHaveLength(1)
    await wrapper.findAll('button').find(button => button.text() === 'Отозвать')?.trigger('click')
    expect(revokeDevice).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === 'Подтвердить')?.trigger('click')
    await flushPromises()
    expect(revokeDevice).toHaveBeenCalledWith('device-other')
  })
})
