import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AdminUsersPanel from '../app/components/admin/AdminUsersPanel.vue'
import ActivationForm from '../app/components/auth/ActivationForm.vue'
import PasswordResetForm from '../app/components/auth/PasswordResetForm.vue'
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
    const listManagedUsers = vi.fn().mockResolvedValue({
      items: [], total: 0, limit: 20, offset: 0,
    })
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

  it('clears reset credentials and passwords after successful recovery', async () => {
    const resetPassword = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(PasswordResetForm, {
      props: { initialSecret: 'r'.repeat(48), resetPassword },
    })
    await wrapper.get('input[name="new-password"]').setValue('new strong local password')
    await wrapper.get('input[name="password-confirmation"]').setValue('new strong local password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(resetPassword).toHaveBeenCalledWith('r'.repeat(48), 'new strong local password')
    expect(wrapper.emitted('completed')).toHaveLength(1)
    expect(wrapper.html()).not.toContain('new strong local password')
    expect(wrapper.html()).not.toContain('r'.repeat(48))
  })

  it('requires explicit confirmation and shows password-reset link transiently', async () => {
    const user = {
      userId: 'bob-id',
      username: 'bob',
      displayName: 'Bob',
      isAdmin: false,
      isActive: true,
      activationPending: false,
      canReactivate: false,
      createdAt: '2026-08-11T12:00:00Z',
      updatedAt: '2026-08-11T12:00:00Z',
      activeSessions: 1,
    }
    const issuePasswordReset = vi.fn().mockResolvedValue({
      userId: 'bob-id',
      resetSecret: 'reset-secret-value',
      expiresAt: '2026-08-11T13:00:00Z',
      revokedSessions: 2,
    })
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        listManagedUsers: {
          execute: vi.fn().mockResolvedValue({ items: [user], total: 1, limit: 20, offset: 0 }),
        },
        inviteUser: { execute: vi.fn() },
        reissueActivation: { execute: vi.fn() },
        setManagedUserActive: { execute: vi.fn() },
        issuePasswordReset: { execute: issuePasswordReset },
        buildInvitationLink: { execute: vi.fn() },
        buildPasswordResetLink: {
          execute: (secret: string) => `https://chat.example/reset-password#token=${secret}`,
        },
        clipboard: { writeText: vi.fn() },
        haptics: { perform: vi.fn() },
      },
    }))
    const wrapper = mount(AdminUsersPanel, { props: { currentUserId: 'admin-id' } })
    await flushPromises()

    const resetButton = wrapper.findAll('button').find(button => button.text() === 'Сбросить пароль')
    await resetButton?.trigger('click')
    expect(issuePasswordReset).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Завершить все сеансы пользователя?')

    const confirmButton = wrapper.findAll('button').find(button => button.text() === 'Подтвердить')
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(issuePasswordReset).toHaveBeenCalledWith('bob-id')
    expect(wrapper.text()).toContain('https://chat.example/reset-password#token=reset-secret-value')
    expect(wrapper.text()).toContain('Все сеансы пользователя завершены (2)')
    const hideButton = wrapper.findAll('button').find(button => button.text() === 'Скрыть')
    await hideButton?.trigger('click')
    expect(wrapper.text()).not.toContain('reset-secret-value')
  })
})
