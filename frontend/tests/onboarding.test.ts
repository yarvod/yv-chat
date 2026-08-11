import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AdminUsersPanel from '../app/components/admin/AdminUsersPanel.vue'
import ActivationForm from '../app/components/auth/ActivationForm.vue'
import { accountAdminService, activationService } from '../app/services/accounts/api'

afterEach(() => vi.restoreAllMocks())

describe('closed onboarding UI', () => {
  it('clears activation credentials after a successful activation', async () => {
    const activate = vi.spyOn(activationService, 'activate').mockResolvedValue({
      userId: 'bob-id',
      activatedAt: '2026-08-11T12:00:00Z',
    })
    const wrapper = mount(ActivationForm)
    await wrapper.get('textarea[name="activation-secret"]').setValue('a'.repeat(48))
    await wrapper.get('input[name="new-password"]').setValue('strong local password')
    await wrapper.get('input[name="password-confirmation"]').setValue('strong local password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(activate).toHaveBeenCalledWith('a'.repeat(48), 'strong local password')
    expect(wrapper.emitted('activated')).toHaveLength(1)
    expect(wrapper.html()).not.toContain('strong local password')
    expect(wrapper.html()).not.toContain('a'.repeat(48))
  })

  it('shows an invitation secret transiently and removes it on demand', async () => {
    vi.spyOn(accountAdminService, 'list')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    vi.spyOn(accountAdminService, 'invite').mockResolvedValue({
      userId: 'bob-id',
      username: 'bob',
      displayName: 'Bob',
      activationSecret: 'one-time-secret-value',
      expiresAt: '2026-08-12T12:00:00Z',
    })
    const wrapper = mount(AdminUsersPanel)
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[0]?.setValue('bob')
    await inputs[1]?.setValue('Bob')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('one-time-secret-value')
    await wrapper.get('.invitation-result .text-button').trigger('click')
    expect(wrapper.text()).not.toContain('one-time-secret-value')
  })
})
