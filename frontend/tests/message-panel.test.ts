import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import MessagePanel from '../app/components/chat/MessagePanel.vue'
import { syntheticMessageCodec } from '../app/infrastructure/crypto/synthetic-message-codec'

const conversation = {
  conversationId: 'conversation-1',
  conversationType: 'direct' as const,
  title: null,
  createdBy: 'alice-id',
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
  members: [
    {
      userId: 'alice-id',
      username: 'alice',
      displayName: 'Alice',
      role: 'member' as const,
      joinedAt: '2026-08-11T12:00:00Z',
      leftAt: null,
    },
    {
      userId: 'bob-id',
      username: 'bob',
      displayName: 'Bob',
      role: 'member' as const,
      joinedAt: '2026-08-11T12:00:00Z',
      leftAt: null,
    },
  ],
}

describe('message panel', () => {
  it('shows the non-E2EE warning and clears a successfully sent draft', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true)
    const setTyping = vi.fn()
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        codec: syntheticMessageCodec,
        sendMessage,
        typingActorIds: [],
        onlineActorIds: ['bob-id'],
        setTyping,
      },
    })

    expect(wrapper.text()).toContain('не защищены E2EE')
    await wrapper.get('textarea').setValue('  hello  ')
    await wrapper.get('form').trigger('submit')

    expect(sendMessage).toHaveBeenCalledWith('  hello  ')
    expect(wrapper.get('textarea').element.value).toBe('')
    expect(setTyping).toHaveBeenCalledWith('conversation-1', true)
    expect(setTyping).toHaveBeenLastCalledWith('conversation-1', false)
  })

  it('renders participant typing state without exposing draft content', () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        codec: syntheticMessageCodec,
        sendMessage: vi.fn(),
        typingActorIds: ['bob-id'],
        onlineActorIds: ['bob-id'],
        setTyping: vi.fn(),
      },
    })

    expect(wrapper.text()).toContain('Bob печатает')
  })
})
