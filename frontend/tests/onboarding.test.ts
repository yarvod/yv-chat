import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AdminUsersPanel from '../app/components/admin/AdminUsersPanel.vue'
import ActivationForm from '../app/components/auth/ActivationForm.vue'
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('closed onboarding UI', () => {
  it('clears activation credentials after a successful activation', async () => {
    const activate = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ActivationForm, { props: { activate } })
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
    const buildInvitationLink = vi.fn((secret: string) => `https://chat.example/activate#token=${secret}`)
    const listManagedUsers = vi.fn().mockResolvedValue([])
    const inviteUser = vi.fn().mockResolvedValue({
      userId: 'bob-id',
      username: 'bob',
      displayName: 'Bob',
      activationSecret: 'one-time-secret-value',
      expiresAt: '2026-08-12T12:00:00Z',
    })
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        listManagedUsers: { execute: listManagedUsers },
        inviteUser: { execute: inviteUser },
        buildInvitationLink: { execute: buildInvitationLink },
        clipboard: { writeText: vi.fn() },
        haptics: { perform: vi.fn() },
      },
    }))
    const wrapper = mount(AdminUsersPanel)
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[0]?.setValue('bob')
    await inputs[1]?.setValue('Bob')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(inviteUser).toHaveBeenCalledWith('bob', 'Bob')
    expect(buildInvitationLink).toHaveBeenCalledWith('one-time-secret-value')
    expect(wrapper.text()).toContain('https://chat.example/activate#token=one-time-secret-value')
    await wrapper.get('.invitation-result .text-button').trigger('click')
    expect(wrapper.text()).not.toContain('one-time-secret-value')
  })
})
