import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { Login } from '../app/application/auth/login'
import type { AuthGateway, LoginCredentials } from '../app/application/ports/auth-gateway'
import type { DeviceInfoPort } from '../app/application/ports/device-info'
import type { HapticsPort } from '../app/application/ports/haptics'
import DeviceReenrollmentForm from '../app/components/auth/DeviceReenrollmentForm.vue'
import LoginForm from '../app/components/auth/LoginForm.vue'

const account = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
  deviceId: '1a166081-37d5-40ea-8238-3f639e7be090',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
}

describe('login application flow', () => {
  it('uses automatic device metadata instead of accepting a device name from UI', async () => {
    const received: LoginCredentials[] = []
    const gateway: AuthGateway = {
      current: vi.fn(),
      logout: vi.fn(),
      login: vi.fn(async credentials => {
        received.push(credentials)
        return account
      }),
    }
    const deviceInfo: DeviceInfoPort = {
      current: () => ({
        label: 'Safari · iOS · Телефон',
        browser: 'Safari',
        operatingSystem: 'iOS',
        deviceClass: 'mobile',
      }),
    }
    const perform = vi.fn()
    const haptics: HapticsPort = { isEnabled: () => true, setEnabled: vi.fn(), perform }

    await new Login(gateway, deviceInfo, haptics).execute({
      username: 'alice',
      password: 'correct horse battery staple',
    })

    expect(received).toEqual([{
      username: 'alice',
      password: 'correct horse battery staple',
      deviceName: 'Safari · iOS · Телефон',
    }])
    expect(perform).toHaveBeenCalledWith('success')
  })

  it('clears the rendered password and never renders a device-name input', async () => {
    const wrapper = mount(LoginForm, {
      props: {
        busy: false,
        message: null,
        offline: false,
        deviceLabel: 'Chrome · macOS · Компьютер',
      },
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
    })
    await wrapper.get('input[name="username"]').setValue('alice')
    await wrapper.get('input[name="password"]').setValue('correct horse battery staple')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]).toEqual([{
      username: 'alice',
      password: 'correct horse battery staple',
    }])
    expect((wrapper.get('input[name="password"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('input[name="device-name"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Chrome · macOS · Компьютер')
    expect(wrapper.html()).not.toContain('correct horse battery staple')
  })

  it('does not invite a password login while the existing session check is temporarily offline', () => {
    const wrapper = mount(LoginForm, {
      props: {
        busy: false,
        message: 'Сервер временно недоступен. Текущая сессия сохранена.',
        offline: true,
        deviceLabel: 'Safari · iOS · Телефон',
      },
      global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('Текущая сессия сохранена')
    expect(wrapper.text()).toContain('Повторить подключение')
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)
    expect(wrapper.find('input[name="password"]').exists()).toBe(false)
  })

  it('clears the iOS PWA re-enrollment password immediately after submit', async () => {
    const wrapper = mount(DeviceReenrollmentForm, {
      props: { busy: false, message: null },
    })
    const password = 'correct horse battery staple'
    await wrapper.get('input[name="device-reenrollment-password"]').setValue(password)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]).toEqual([password])
    expect(
      (wrapper.get('input[name="device-reenrollment-password"]').element as HTMLInputElement).value,
    ).toBe('')
    expect(wrapper.html()).not.toContain(password)
    expect(wrapper.text()).toContain('не отключая Safari')
  })
})
