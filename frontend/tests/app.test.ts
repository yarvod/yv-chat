import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../app/app.vue'
import { ApiError } from '../app/services/api'
import { authService } from '../app/services/auth'

const account = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
}

afterEach(() => vi.restoreAllMocks())

describe('auth shell', () => {
  it('bootstraps signed-out state and authenticates without exposing a credential', async () => {
    vi.spyOn(authService, 'current').mockRejectedValue(new ApiError(401, 'http', 'unauthorized'))
    const login = vi.spyOn(authService, 'login').mockResolvedValue(account)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('yv-chat')
    await wrapper.get('input[name="username"]').setValue('alice')
    await wrapper.get('input[name="password"]').setValue('correct horse battery staple')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(login).toHaveBeenCalledWith({
      username: 'alice',
      password: 'correct horse battery staple',
      deviceName: 'Этот браузер',
    })
    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.text()).toContain('@alice')
    expect(wrapper.html()).not.toContain('correct horse battery staple')
  })
})
