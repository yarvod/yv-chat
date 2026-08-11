import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { Login } from '../app/application/auth/login'
import type { AuthGateway, LoginCredentials } from '../app/application/ports/auth-gateway'
import type { DeviceInfoPort } from '../app/application/ports/device-info'
import type { HapticsPort } from '../app/application/ports/haptics'
import LoginForm from '../app/components/auth/LoginForm.vue'

const account = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
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
})
