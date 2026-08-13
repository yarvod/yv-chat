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
  it('registers without rendering the invitation secret and clears passwords', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(ActivationForm, { props: { hasInvitation: true, register } })
    await wrapper.get('input[name="username"]').setValue('Alice')
    await wrapper.get('input[name="name"]').setValue('Alice Smith')
    await wrapper.get('input[name="new-password"]').setValue('strong local password')
    await wrapper.get('input[name="password-confirmation"]').setValue('strong local password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(register).toHaveBeenCalledWith('alice', 'Alice Smith', 'strong local password')
    expect(wrapper.emitted('registered')).toHaveLength(1)
    expect(wrapper.html()).not.toContain('strong local password')
    expect(wrapper.find('[name="activation-secret"]').exists()).toBe(false)
    expect(wrapper.get('input[name="username"]').attributes('autocomplete')).toBe('username')
  })

  it('shows an invitation secret transiently and removes it on demand', async () => {
    const buildInvitationLink = vi.fn((secret: string) => `https://chat.example/activate#token=${secret}`)
    const listManagedUsers = vi.fn().mockResolvedValue({
      items: [], total: 0, limit: 20, offset: 0,
    })
    const createRegistrationInvitation = vi.fn().mockResolvedValue({
      invitationId: 'invite-id',
      label: 'Для Боба',
      activationSecret: 'one-time-secret-value',
      createdAt: '2026-08-11T12:00:00Z',
      expiresAt: '2026-08-12T12:00:00Z',
    })
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        listManagedUsers: { execute: listManagedUsers },
        listRegistrationInvitations: {
          execute: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
        createRegistrationInvitation: { execute: createRegistrationInvitation },
        revokeRegistrationInvitation: { execute: vi.fn() },
        buildInvitationLink: { execute: buildInvitationLink },
        clipboard: { writeText: vi.fn() },
        haptics: { perform: vi.fn() },
      },
    }))
    const wrapper = mount(AdminUsersPanel)
    await flushPromises()
    await wrapper.get('.invite-form--standalone input').setValue('Для Боба')
    await wrapper.get('.invite-form--standalone').trigger('submit')
    await flushPromises()

    expect(createRegistrationInvitation).toHaveBeenCalledWith('Для Боба')
    expect(buildInvitationLink).toHaveBeenCalledWith('one-time-secret-value')
    expect(wrapper.text()).toContain('https://chat.example/activate#token=one-time-secret-value')
    expect(wrapper.find('.invitation-qr svg').exists()).toBe(true)
    await wrapper.get('.invitation-result .text-button').trigger('click')
    expect(wrapper.text()).not.toContain('one-time-secret-value')
  })

  it('lists and explicitly revokes an active standalone invitation', async () => {
    const activeInvitation = {
      invitationId: 'invite-id',
      label: 'Для Боба',
      status: 'active',
      createdByUsername: 'admin',
      registeredUserId: null,
      registeredUsername: null,
      createdAt: '2026-08-12T12:00:00Z',
      expiresAt: '2026-08-13T12:00:00Z',
      usedAt: null,
      revokedAt: null,
    }
    const listInvitations = vi.fn()
      .mockResolvedValueOnce({ items: [activeInvitation], total: 1, limit: 20, offset: 0 })
      .mockResolvedValueOnce({
        items: [{ ...activeInvitation, status: 'revoked', revokedAt: '2026-08-12T13:00:00Z' }],
        total: 1,
        limit: 20,
        offset: 0,
      })
    const revokeInvitation = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        listManagedUsers: {
          execute: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
        listRegistrationInvitations: { execute: listInvitations },
        createRegistrationInvitation: { execute: vi.fn() },
        revokeRegistrationInvitation: { execute: revokeInvitation },
        clipboard: { writeText: vi.fn() },
        haptics: { perform: vi.fn() },
      },
    }))
    const wrapper = mount(AdminUsersPanel)
    await flushPromises()

    await wrapper.get('.registration-invitation-row .text-button').trigger('click')
    expect(wrapper.text()).toContain('Отозвать приглашение?')
    await wrapper.get('[role="alertdialog"] .button--primary').trigger('click')
    await flushPromises()

    expect(revokeInvitation).toHaveBeenCalledWith('invite-id')
    expect(wrapper.text()).toContain('отозвано')
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
        listRegistrationInvitations: {
          execute: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        },
        createRegistrationInvitation: { execute: vi.fn() },
        revokeRegistrationInvitation: { execute: vi.fn() },
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
