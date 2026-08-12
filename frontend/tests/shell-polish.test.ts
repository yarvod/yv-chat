import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConversationSidebar from '../app/components/chat/ConversationSidebar.vue'
import LogoutDeviceCard from '../app/components/settings/LogoutDeviceCard.vue'
import BrandMark from '../app/components/ui/BrandMark.vue'
import ConnectionStatus from '../app/components/ui/ConnectionStatus.vue'

afterEach(() => {
  vi.unstubAllGlobals()
})

const user = {
  userId: '8ec81303-0613-4ed6-bf79-4eecff0ceada',
  deviceId: '1a166081-37d5-40ea-8238-3f639e7be090',
  username: 'alice',
  displayName: 'Alice',
  isAdmin: false,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
}

describe('branded application shell', () => {
  it('renders the canonical mark instead of a textual Y', () => {
    const wrapper = mount(BrandMark, { props: { size: 'rail' } })
    expect(wrapper.get('img').attributes('src')).toContain('svg')
    expect(wrapper.text()).toBe('')
  })

  it('keeps chat creation but removes duplicate brand and account footer', () => {
    const wrapper = mount(ConversationSidebar, {
      props: {
        user,
        conversations: [],
        directory: [],
        activeConversationId: null,
        readStates: [],
        presenceIndicators: [],
        creating: false,
      },
    })
    expect(wrapper.get('button[aria-label="Новый диалог"]').exists()).toBe(true)
    expect(wrapper.find('.brand-row').exists()).toBe(false)
    expect(wrapper.find('.account-row').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('yv-chat')
    expect(wrapper.text()).not.toContain('@alice')
  })
})

describe('global connection status', () => {
  it('shows transient and offline states but removes stable connected state', async () => {
    const state = ref('checking')
    let reportState: ((state: string) => void) | null = null
    vi.stubGlobal('useState', () => state)
    vi.stubGlobal('useNuxtApp', () => ({
      $frontend: {
        createConnectionMonitor: () => ({
          start: (listener: (next: string) => void) => { reportState = listener },
          stop: vi.fn(),
        }),
      },
    }))

    const wrapper = mount(ConnectionStatus)
    expect(wrapper.get('[role="status"]').text()).toContain('Проверяем соединение')

    reportState?.('connected')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)

    reportState?.('offline')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('Нет соединения')
  })
})

describe('current-device logout confirmation', () => {
  it('requires an explicit second action and supports cancellation', async () => {
    const wrapper = mount(LogoutDeviceCard, { props: { busy: false, error: null } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.text()).toContain('Точно выйти?')
    expect(wrapper.text()).toContain('не переносит его ключи')

    await wrapper.get('.secondary-button').trigger('click')
    expect(wrapper.text()).not.toContain('Точно выйти?')
    await wrapper.get('button').trigger('click')
    await wrapper.get('.logout-confirm-dialog .danger-button').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('disables confirmation while logout is in flight', async () => {
    const wrapper = mount(LogoutDeviceCard, { props: { busy: false, error: null } })
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ busy: true })
    expect(wrapper.get('.logout-confirm-dialog .danger-button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Выходим…')
  })

  it('keeps a failed logout visible inside the confirmation dialog', async () => {
    const wrapper = mount(LogoutDeviceCard, { props: { busy: false, error: null } })
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ error: 'Сеанс не завершён.' })

    expect(wrapper.get('.logout-confirm-dialog [role="alert"]').text()).toBe('Сеанс не завершён.')
  })
})
