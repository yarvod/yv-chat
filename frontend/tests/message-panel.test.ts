import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import MessagePanel from '../app/components/chat/MessagePanel.vue'

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
  it('renders optimistic outbox states and exposes retry only for failed messages', async () => {
    const retryOutgoing = vi.fn().mockResolvedValue(true)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        outgoingMessages: [{
          clientMessageId: 'pending-1',
          conversationId: 'conversation-1',
          createdAt: '2026-08-11T12:00:00Z',
          displayBody: 'queued text',
          contentSecure: false,
          status: 'pending',
          attemptCount: 1,
          failureCode: null,
        }, {
          clientMessageId: 'failed-1',
          conversationId: 'conversation-1',
          createdAt: '2026-08-11T12:00:01Z',
          displayBody: 'failed text',
          contentSecure: false,
          status: 'failed',
          attemptCount: 2,
          failureCode: 'conflict',
        }],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        retryOutgoing,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'reconnecting',
        setTyping: vi.fn(),
      },
    })

    expect(wrapper.text()).toContain('queued text')
    expect(wrapper.text()).toContain('В очереди')
    expect(wrapper.text()).toContain('Конфликт идентификатора')
    expect(wrapper.findAll('.outbox-meta button')).toHaveLength(1)
    await wrapper.get('.outbox-meta button').trigger('click')
    expect(retryOutgoing).toHaveBeenCalledWith('failed-1')
  })

  it('shows the non-E2EE warning and clears a successfully sent draft', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true)
    const setTyping = vi.fn()
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: ['bob-id'],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping,
      },
    })

    expect(wrapper.text()).toContain('Тестовый режим без E2EE')
    expect(wrapper.text()).toContain('Не отправляйте чувствительные данные')
    await wrapper.get('textarea').setValue('  hello  ')
    await wrapper.get('form').trigger('submit')

    expect(sendMessage).toHaveBeenCalledWith('  hello  ')
    expect(wrapper.get('textarea').element.value).toBe('')
    expect(setTyping).toHaveBeenCalledWith('conversation-1', true)
    expect(setTyping).toHaveBeenLastCalledWith('conversation-1', false)
  })

  it('keeps the draft when durable enqueue fails and explains unavailable outbox', async () => {
    const sendMessage = vi.fn().mockResolvedValue(false)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        outboxStatus: 'unavailable',
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    await wrapper.get('textarea').setValue('do not lose me')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('textarea').element.value).toBe('do not lose me')
    expect(wrapper.text()).toContain('Надёжная очередь отправки недоступна')
  })

  it('renders participant typing state without exposing draft content', () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: ['bob-id'],
        onlineActorIds: ['bob-id'],
        deliveryStates: [],
        connectionState: 'reconnecting',
        setTyping: vi.fn(),
      },
    })

    expect(wrapper.text()).toContain('Bob печатает')
    expect(wrapper.get('.connection-dot').attributes('title')).toBe('Переподключаем синхронизацию')
  })

  it('shows delivered only after a recipient aggregate reaches the own message', async () => {
    const ownMessage = {
      messageId: 'message-1',
      clientMessageId: 'client-1',
      conversationId: 'conversation-1',
      senderUserId: 'alice-id',
      senderDeviceId: 'alice-device',
      protocolVersion: 1,
      sequence: 3,
      createdAt: '2026-08-11T12:00:01Z',
      ciphertextBase64: 'aGVsbG8=',
      expiresAt: '2026-09-10T12:00:01Z',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'hello',
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [ownMessage],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [{
          conversationId: 'conversation-1',
          userId: 'bob-id',
          deliveredSequence: 2,
        }],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    expect(wrapper.text()).toContain('Отправлено')
    await wrapper.setProps({
      deliveryStates: [{
        conversationId: 'conversation-1',
        userId: 'bob-id',
        deliveredSequence: 3,
      }],
    })
    expect(wrapper.text()).toContain('Доставлено')
  })

  it('requires explicit confirmation and renders a tombstone without decoding', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [{
          messageId: 'message-1',
          clientMessageId: 'client-1',
          conversationId: 'conversation-1',
          senderUserId: 'alice-id',
          senderDeviceId: 'alice-device',
          protocolVersion: 1,
          sequence: 1,
          createdAt: '2026-08-11T12:00:01Z',
          expiresAt: '2026-09-10T12:00:01Z',
          ciphertextBase64: 'aGVsbG8=',
          deletionReason: null,
          deletedAt: null,
          contentState: 'available' as const,
          displayBody: 'hello',
          contentSecure: false,
        }],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        deleteMessage,
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    await wrapper.get('.message-actions > button').trigger('click')
    expect(deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('без возможности восстановления')
    await wrapper.get('.message-actions button').trigger('click')
    expect(deleteMessage).toHaveBeenCalledWith('message-1')

    await wrapper.setProps({
      messages: [{
        ...wrapper.props('messages')[0],
        ciphertextBase64: null,
        deletionReason: 'manual',
        deletedAt: '2026-08-11T12:01:00Z',
        contentState: 'deleted',
        displayBody: null,
        contentSecure: false,
      }],
    })
    expect(wrapper.text()).toContain('Сообщение удалено для всех')
    expect(wrapper.find('.message-actions').exists()).toBe(false)
  })

  it('renders a safe unavailable state without exposing ciphertext', () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [{
          messageId: 'message-mls',
          clientMessageId: 'client-mls',
          conversationId: 'conversation-1',
          senderUserId: 'bob-id',
          senderDeviceId: 'bob-device',
          protocolVersion: 2,
          sequence: 2,
          createdAt: '2026-08-11T12:00:02Z',
          expiresAt: '2026-09-10T12:00:02Z',
          ciphertextBase64: 'c2Vuc2l0aXZlLW9wYXF1ZS1ieXRlcw==',
          deletionReason: null,
          deletedAt: null,
          contentState: 'unavailable',
          displayBody: 'Защищённое сообщение недоступно на этом устройстве.',
          contentSecure: false,
        }],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    expect(wrapper.text()).toContain('Защищённое сообщение недоступно')
    expect(wrapper.text()).not.toContain('c2Vuc2l0aXZlLW9wYXF1ZS1ieXRlcw')
  })

  it('sends on Enter while preserving Shift+Enter for multiline input', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })
    const input = wrapper.get('textarea')
    await input.setValue('две\nстроки')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(sendMessage).not.toHaveBeenCalled()
    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(composingEnter, 'isComposing', { value: true })
    input.element.dispatchEvent(composingEnter)
    await wrapper.vm.$nextTick()
    expect(sendMessage).not.toHaveBeenCalled()
    await input.trigger('keydown', { key: 'Enter' })
    expect(sendMessage).toHaveBeenCalledWith('две\nстроки')
  })

  it('auto-grows the composer only up to its bounded height', async () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })
    const input = wrapper.get('textarea').element as HTMLTextAreaElement
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 104 })
    await wrapper.get('textarea').trigger('input')
    expect(input.style.height).toBe('104px')
    expect(input.style.overflowY).toBe('hidden')

    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 220 })
    await wrapper.get('textarea').trigger('input')
    expect(input.style.height).toBe('128px')
    expect(input.style.overflowY).toBe('auto')
  })

  it('does not jump to an incoming message while the user reads history', async () => {
    const firstMessage = {
      messageId: 'message-1',
      clientMessageId: 'client-1',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      sequence: 1,
      createdAt: '2026-08-11T12:00:01Z',
      expiresAt: '2026-09-10T12:00:01Z',
      ciphertextBase64: 'aGVsbG8=',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'hello',
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [firstMessage],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    const scrollTo = vi.fn()
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 200, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    })

    await wrapper.setProps({
      messages: [{ ...firstMessage }, {
        ...firstMessage,
        messageId: 'message-2',
        clientMessageId: 'client-2',
        sequence: 2,
        createdAt: '2026-08-11T12:01:00Z',
      }],
    })

    expect(scrollTo).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(wrapper.find('.scroll-to-latest').exists()).toBe(true)
    })
    await wrapper.get('.scroll-to-latest').trigger('click')
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'smooth' })
  })

  it('prepends older history while preserving the visual scroll anchor', async () => {
    const latestMessage = {
      messageId: 'message-2',
      clientMessageId: 'client-2',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      sequence: 2,
      createdAt: '2026-08-11T12:01:00Z',
      expiresAt: '2026-09-10T12:01:00Z',
      ciphertextBase64: 'aGVsbG8=',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'latest',
      contentSecure: false,
    }
    const olderMessage = {
      ...latestMessage,
      messageId: 'message-1',
      clientMessageId: 'client-1',
      sequence: 1,
      createdAt: '2026-08-11T12:00:00Z',
      displayBody: 'older',
    }
    const wrapperRef: { current: VueWrapper | null } = { current: null }
    let scrollHeight = 1_200
    const loadOlder = vi.fn(async () => {
      scrollHeight = 1_400
      const mounted = wrapperRef.current
      if (!mounted) throw new Error('message panel is not mounted')
      await mounted.setProps({ messages: [olderMessage, latestMessage], historyHasMore: false })
    })
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [latestMessage],
        historyHasMore: true,
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Тестовый режим без E2EE',
        sendMessage: vi.fn(),
        loadOlder,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })
    wrapperRef.current = wrapper
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 200, writable: true },
      scrollTo: { configurable: true, value: vi.fn() },
    })

    await wrapper.get('.load-older').trigger('click')
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(timeline.scrollTop).toBe(400))
    expect(wrapper.text()).toContain('older')
  })
})
