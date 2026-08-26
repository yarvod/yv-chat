import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import MessagePanel from '../app/components/chat/MessagePanel.vue'
import type { ConversationViewportAnchor } from '../app/application/ports/messenger-snapshot-store'

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
  it('opens conversation details when the chat identity is pressed', async () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
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

    await wrapper.get('.conversation-profile-button').trigger('click')

    expect(wrapper.emitted('details')).toHaveLength(1)
  })

  it('renders an encrypted missed-call item as call history instead of empty text', () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [{
          messageId: 'call-message',
          clientMessageId: 'call-client',
          conversationId: 'conversation-1',
          senderUserId: 'bob-id',
          senderDeviceId: 'bob-device',
          protocolVersion: 2,
          cryptoGenerationId: 'generation',
          cryptoEpoch: 4,
          sequence: 1,
          createdAt: '2026-08-19T12:00:00Z',
          expiresAt: '2026-09-18T12:00:00Z',
          ciphertextBase64: 'b3BhcXVl',
          deletionReason: null,
          deletedAt: null,
          contentState: 'available' as const,
          displayBody: '',
          call: {
            callId: '60cf6877-9dd1-454e-86ac-f42303c7775a',
            outcome: 'missed' as const,
            durationSeconds: 0,
          },
          contentSecure: true,
        }],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
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

    expect(wrapper.get('.message-bubble--call').text()).toContain('Пропущенный звонок')
    expect(wrapper.get('.call-history').text()).toContain('Входящий')
    expect(wrapper.find('.message-unavailable').exists()).toBe(false)
  })

  it('cycles multiple pins, opens the exact message and exposes direct-chat pin actions', async () => {
    const messages = [1, 2].map(sequence => ({
      messageId: `message-${sequence}`,
      clientMessageId: `client-${sequence}`,
      conversationId: 'conversation-1',
      senderUserId: sequence === 1 ? 'alice-id' : 'bob-id',
      senderDeviceId: `device-${sequence}`,
      protocolVersion: 1,
      cryptoGenerationId: null,
      cryptoEpoch: null,
      sequence,
      createdAt: `2026-08-17T12:00:0${sequence}Z`,
      expiresAt: '2026-09-16T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: sequence === 1 ? 'Первый закреп' : 'Второй закреп',
      contentSecure: true,
    }))
    const openMessage = vi.fn().mockResolvedValue(undefined)
    const togglePin = vi.fn().mockResolvedValue(true)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages,
        messagePins: [{
          messageId: 'message-2', sequence: 2, pinnedByUserId: 'alice-id',
          pinnedAt: '2026-08-17T12:01:02Z',
        }, {
          messageId: 'message-1', sequence: 1, pinnedByUserId: 'bob-id',
          pinnedAt: '2026-08-17T12:01:01Z',
        }],
        openMessage,
        togglePin,
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
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

    expect(wrapper.get('.pinned-message-bar').text()).toContain('Второй закреп')
    expect(wrapper.get('.pinned-message-count').text()).toBe('1/2')
    await wrapper.get('[aria-label="Следующее закреплённое сообщение"]').trigger('click')
    expect(wrapper.get('.pinned-message-bar').text()).toContain('Первый закреп')
    await wrapper.get('.pinned-message-main').trigger('click')
    expect(openMessage).toHaveBeenCalledWith('message-1')

    await wrapper.get('.pinned-message-close').trigger('click')
    expect(togglePin).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Убрать из закреплённых')
    await wrapper.get('.message-confirm-dialog button').trigger('click')
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect(togglePin).not.toHaveBeenCalled()
    await wrapper.get('.pinned-message-close').trigger('click')
    await wrapper.get('.message-confirm-dialog button.danger').trigger('click')
    expect(togglePin).toHaveBeenCalledWith('message-1', false)

    await wrapper.get('[data-message-id="message-2"]').trigger('contextmenu', {
      clientX: 120,
      clientY: 140,
    })
    expect(wrapper.get('.message-context-menu').text()).toContain('Открепить')
  })

  it('replies on a deliberate right swipe and opens actions on touch long-press', async () => {
    vi.useFakeTimers()
    const copyText = vi.fn().mockResolvedValue(true)
    const message = {
      messageId: 'message-gesture',
      clientMessageId: 'client-gesture',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      cryptoGenerationId: null,
      cryptoEpoch: null,
      sequence: 1,
      createdAt: '2026-08-17T12:00:01Z',
      expiresAt: '2026-09-16T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'Жесты сообщения',
      contentSecure: true,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [message],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        copyText,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })
    const bubble = wrapper.get('[data-message-id="message-gesture"]')

    bubble.element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 20,
    }))
    bubble.element.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', clientX: 18, clientY: 90,
    }))
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.find('.message-context-menu').exists()).toBe(false)
    bubble.element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 3, pointerType: 'touch', clientX: 18, clientY: 90,
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.composer-reply').exists()).toBe(false)

    bubble.element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 20,
    }))
    bubble.element.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 22,
    }))
    await wrapper.vm.$nextTick()
    expect(bubble.classes()).toContain('message-bubble--swiping')
    bubble.element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 22,
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.composer-reply').text()).toContain('Жесты сообщения')
    await wrapper.get('.composer-reply button').trigger('click')

    bubble.element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 50,
    }))
    bubble.element.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', clientX: 44, clientY: 57,
    }))
    await vi.advanceTimersByTimeAsync(500)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.message-context-menu').text()).toContain('Ответить')
    expect(wrapper.get('.message-context-menu').text()).toContain('Копировать текст')
    bubble.element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 50,
    }))
    await wrapper.get('.context-message-actions button:nth-child(2)').trigger('click')
    expect(copyText).toHaveBeenCalledWith('Жесты сообщения')
    expect(wrapper.get('.message-action-toast').text()).toBe('Текст скопирован')
    expect(wrapper.find('.message-context-menu').exists()).toBe(false)

    await bubble.trigger('keydown', { key: 'F10', shiftKey: true })
    expect(wrapper.get('.message-context-menu').attributes('role')).toBe('menu')
    await wrapper.get('.message-context-backdrop').trigger('pointerdown')

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('supports reply and long-press directly on a photo without stealing a tap', async () => {
    vi.useFakeTimers()
    const message = {
      messageId: 'message-photo-gesture',
      clientMessageId: 'client-photo-gesture',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 2,
      cryptoGenerationId: 'generation-1',
      cryptoEpoch: 1,
      sequence: 1,
      createdAt: '2026-08-26T12:00:01Z',
      expiresAt: '2026-09-26T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: '',
      displayAttachments: [{
        attachmentId: 'photo-1',
        kind: 'image' as const,
        name: 'photo.jpg',
        contentType: 'image/jpeg',
        byteSize: 128,
      }],
      contentSecure: true,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [message],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
      global: {
        stubs: {
          MessageAttachments: {
            template: '<div class="message-photo-shell fake-photo-shell"><button class="message-photo fake-photo" type="button">photo</button></div>',
          },
        },
      },
    })
    const bubble = wrapper.get('[data-message-id="message-photo-gesture"]')
    const photo = wrapper.get('.fake-photo')
    const viewerClick = vi.fn()
    photo.element.addEventListener('click', viewerClick)
    const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => (
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId,
        pointerType: 'touch',
        clientX,
        clientY,
      })
    )
    const viewerTap = () => photo.element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }))

    photo.element.dispatchEvent(pointer('pointerdown', 1, 24, 30))
    photo.element.dispatchEvent(pointer('pointerup', 1, 24, 30))
    expect(viewerTap()).toBe(true)
    expect(viewerClick).toHaveBeenCalledTimes(1)

    photo.element.dispatchEvent(pointer('pointerdown', 2, 40, 50))
    photo.element.dispatchEvent(pointer('pointermove', 2, 44, 57))
    await vi.advanceTimersByTimeAsync(500)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.message-context-menu').text()).toContain('Ответить')
    photo.element.dispatchEvent(pointer('pointerup', 2, 44, 57))
    expect(viewerTap()).toBe(false)
    expect(viewerClick).toHaveBeenCalledTimes(1)
    await wrapper.get('.message-context-backdrop').trigger('pointerdown')

    photo.element.dispatchEvent(pointer('pointerdown', 3, 10, 20))
    photo.element.dispatchEvent(pointer('pointermove', 3, 100, 22))
    await wrapper.vm.$nextTick()
    expect(bubble.classes()).toContain('message-bubble--swiping')
    photo.element.dispatchEvent(pointer('pointerup', 3, 100, 22))
    expect(viewerTap()).toBe(false)
    expect(viewerClick).toHaveBeenCalledTimes(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.composer-reply').text()).toContain('photo.jpg')

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('keeps the context menu open and reports clipboard failure', async () => {
    const copyText = vi.fn().mockResolvedValue(false)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [{
          messageId: 'message-copy-failure',
          clientMessageId: 'client-copy-failure',
          conversationId: 'conversation-1',
          senderUserId: 'bob-id',
          senderDeviceId: 'bob-device',
          protocolVersion: 1,
          cryptoGenerationId: null,
          cryptoEpoch: null,
          sequence: 1,
          createdAt: '2026-08-17T12:00:01Z',
          expiresAt: '2026-09-16T12:00:00Z',
          ciphertextBase64: 'b3BhcXVl',
          deletionReason: null,
          deletedAt: null,
          contentState: 'available' as const,
          displayBody: '  Точный текст с пробелами  ',
          contentSecure: true,
        }],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        copyText,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    await wrapper.get('[data-message-id="message-copy-failure"]').trigger('contextmenu')
    await wrapper.get('.context-message-actions button:nth-child(2)').trigger('click')

    expect(copyText).toHaveBeenCalledWith('  Точный текст с пробелами  ')
    expect(wrapper.get('.message-action-toast').text()).toBe('Не удалось скопировать текст')
    expect(wrapper.find('.message-context-menu').exists()).toBe(true)
  })

  it('selects multiple messages and copies visible text with sender and timestamp', async () => {
    const copyText = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const messages = [{
      messageId: 'message-selected-2',
      clientMessageId: 'client-selected-2',
      conversationId: 'conversation-1',
      senderUserId: 'alice-id',
      senderDeviceId: 'alice-device',
      protocolVersion: 2,
      cryptoGenerationId: 'generation',
      cryptoEpoch: 1,
      sequence: 2,
      createdAt: '2026-08-22T00:40:00',
      expiresAt: '2026-09-21T00:00:00',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'Второе сообщение',
      contentSecure: true,
    }, {
      messageId: 'message-selected-1',
      clientMessageId: 'client-selected-1',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 2,
      cryptoGenerationId: 'generation',
      cryptoEpoch: 1,
      sequence: 1,
      createdAt: '2026-08-22T00:39:00',
      expiresAt: '2026-09-21T00:00:00',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'Первое сообщение',
      contentSecure: true,
    }]
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages,
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        copyText,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    await wrapper.get('[data-message-id="message-selected-1"]').trigger('contextmenu')
    expect(wrapper.get('.message-context-menu').text()).toContain('Выбрать')
    await wrapper.get('.context-message-actions button:nth-child(3)').trigger('click')

    expect(wrapper.get('.message-selection-header').text()).toContain('1 выбрано')
    expect(wrapper.find('form.composer').exists()).toBe(false)
    expect(wrapper.findAll('.message-selection-marker')).toHaveLength(2)
    expect(wrapper.get('[data-message-id="message-selected-1"]').attributes('aria-checked')).toBe('true')

    await wrapper.get('[data-message-id="message-selected-2"]').trigger('keydown', { key: ' ' })
    expect(wrapper.get('.message-selection-header').text()).toContain('2 выбрано')
    await wrapper.get('.message-selection-copy').trigger('click')

    const expected = 'Bob, [22.08.2026 00:39]\nПервое сообщение\n\n'
      + 'Alice, [22.08.2026 00:40]\nВторое сообщение'
    expect(copyText).toHaveBeenLastCalledWith(expected)
    expect(wrapper.get('.message-selection-header').text()).toContain('2 выбрано')
    expect(wrapper.get('.message-action-toast').text()).toBe('Не удалось скопировать сообщения')

    await wrapper.get('.message-selection-copy').trigger('click')
    expect(copyText).toHaveBeenLastCalledWith(expected)
    expect(wrapper.find('.message-selection-header').exists()).toBe(false)
    expect(wrapper.find('form.composer').exists()).toBe(true)
    expect(wrapper.get('.message-action-toast').text()).toBe('Скопировано сообщений: 2')

    await wrapper.get('[data-message-id="message-selected-1"]').trigger('contextmenu')
    await wrapper.get('.context-message-actions button:nth-child(3)').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.message-selection-header').exists()).toBe(false)

    await wrapper.get('[data-message-id="message-selected-1"]').trigger('contextmenu')
    await wrapper.get('.context-message-actions button:nth-child(3)').trigger('click')
    await wrapper.setProps({
      conversation: { ...conversation, conversationId: 'conversation-2' },
    })
    expect(wrapper.find('.message-selection-header').exists()).toBe(false)
  })

  it('renders a standalone video note without the generic square message frame', async () => {
    vi.useFakeTimers()
    const videoNoteMessage = {
      messageId: 'video-note-message',
      clientMessageId: 'video-note-client',
      conversationId: 'conversation-1',
      senderUserId: 'alice-id',
      senderDeviceId: 'alice-device',
      protocolVersion: 1,
      sequence: 1,
      createdAt: '2026-08-13T12:00:00Z',
      expiresAt: '2026-09-12T12:00:00Z',
      ciphertextBase64: 'dmlkZW8tbm90ZQ==',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: '',
      displayAttachments: [{
        attachmentId: 'video-note-1',
        kind: 'video' as const,
        name: 'video-note.webm',
        contentType: 'video/webm',
        byteSize: 420,
        presentation: 'video_note' as const,
        durationSeconds: 9,
      }],
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: { ...conversation, conversationType: 'group', title: 'Team' },
        messages: [videoNoteMessage],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Группа без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
      global: {
        stubs: {
          MessageAttachments: {
            template: '<div class="message-video-note-shell fake-video-note-shell"><button class="message-video-note fake-video-note" type="button">video note</button></div>',
          },
        },
      },
    })

    const bubble = wrapper.get('.message-bubble')
    const videoNoteShell = wrapper.get('.fake-video-note-shell')
    const videoNote = wrapper.get('.fake-video-note')
    const playbackClick = vi.fn()
    videoNote.element.addEventListener('click', playbackClick)
    const pointer = (type: string, pointerId: number, clientX: number, clientY: number, pointerType = 'touch') => (
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId,
        pointerType,
        clientX,
        clientY,
      })
    )
    const playbackTap = () => videoNote.element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }))

    expect(bubble.classes()).toContain('message-bubble--video-note')

    videoNote.element.dispatchEvent(pointer('pointerdown', 1, 24, 30))
    videoNote.element.dispatchEvent(pointer('pointerup', 1, 24, 30))
    expect(playbackTap()).toBe(true)
    expect(playbackClick).toHaveBeenCalledTimes(1)

    videoNoteShell.element.dispatchEvent(pointer('pointerdown', 2, 40, 50))
    videoNoteShell.element.dispatchEvent(pointer('pointermove', 2, 44, 57))
    await vi.advanceTimersByTimeAsync(500)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.message-context-menu').text()).toContain('Ответить')
    expect(wrapper.get('.message-context-menu').text()).not.toContain('Копировать текст')
    videoNoteShell.element.dispatchEvent(pointer('pointerup', 2, 44, 57))
    expect(playbackTap()).toBe(false)
    expect(playbackClick).toHaveBeenCalledTimes(1)
    await wrapper.get('.message-context-backdrop').trigger('pointerdown')

    videoNote.element.dispatchEvent(pointer('pointerdown', 3, 10, 20))
    videoNote.element.dispatchEvent(pointer('pointermove', 3, 100, 22))
    await wrapper.vm.$nextTick()
    expect(bubble.classes()).toContain('message-bubble--swiping')
    videoNote.element.dispatchEvent(pointer('pointerup', 3, 100, 22))
    expect(playbackTap()).toBe(false)
    expect(playbackClick).toHaveBeenCalledTimes(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.composer-reply').text()).toContain('video-note.webm')
    await wrapper.get('.composer-reply button').trigger('click')

    videoNote.element.dispatchEvent(pointer('pointerdown', 4, 30, 30))
    videoNote.element.dispatchEvent(pointer('pointerup', 4, 30, 30))
    expect(playbackTap()).toBe(true)
    expect(playbackClick).toHaveBeenCalledTimes(2)

    videoNote.element.dispatchEvent(pointer('pointerdown', 5, 10, 20, 'mouse'))
    videoNote.element.dispatchEvent(pointer('pointermove', 5, 100, 20, 'mouse'))
    videoNote.element.dispatchEvent(pointer('pointerup', 5, 100, 20, 'mouse'))
    expect(bubble.classes()).not.toContain('message-bubble--swiping')
    expect(wrapper.find('.composer-reply').exists()).toBe(false)

    await videoNoteShell.trigger('contextmenu', { clientX: 60, clientY: 70 })
    expect(wrapper.get('.message-context-menu').text()).toContain('Ответить')
    await wrapper.get('.context-message-actions button:first-child').trigger('click')
    expect(wrapper.get('.composer-reply').text()).toContain('video-note.webm')

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('opens intentional pickers and sends an ordered photo/video/arbitrary-file batch', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    const sendMessage = vi.fn().mockResolvedValue(true)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: { ...conversation, conversationType: 'group', title: 'Team' },
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Группа без E2EE',
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
    const mediaInput = wrapper.get<HTMLInputElement>('input[data-picker="media"]')
    const stickerInput = wrapper.get<HTMLInputElement>('input[data-picker="sticker"]')
    const fileInput = wrapper.get<HTMLInputElement>('input[data-picker="file"]')
    expect(mediaInput.attributes('accept')).toBe('image/*,video/*')
    expect(stickerInput.attributes('accept')).toContain('image/gif')
    expect(fileInput.attributes('accept')).toBeUndefined()
    await wrapper.get('.attach-button').trigger('click')
    expect(wrapper.text()).toContain('Открыть системную галерею')
    expect(wrapper.text()).toContain('Стикер или GIF')
    expect(wrapper.text()).toContain('Выбрать любой тип')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.attachment-picker-menu').exists()).toBe(false)

    const photos = Array.from({ length: 8 }, (_, index) => (
      new File([`photo-${index}`], `photo-${index}.png`, { type: 'image/png' })
    ))
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    Object.defineProperty(mediaInput.element, 'files', {
      configurable: true,
      value: [...photos, video],
    })
    await mediaInput.trigger('change')
    const arbitrary = new File(['custom'], 'archive.yvwhatever', { type: '' })
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [arbitrary] })
    await fileInput.trigger('change')

    expect(wrapper.text()).toContain('10 из 10')
    expect(wrapper.text()).toContain('photo-0.png')
    expect(wrapper.text()).toContain('clip.mp4')
    expect(wrapper.text()).toContain('archive.yvwhatever')
    expect(wrapper.find('.composer-attachment video').exists()).toBe(true)
    expect(wrapper.text()).toContain('не E2EE')
    const overflow = new File(['overflow'], 'overflow.png', { type: 'image/png' })
    Object.defineProperty(mediaInput.element, 'files', { configurable: true, value: [overflow] })
    await mediaInput.trigger('change')
    expect(wrapper.text()).toContain('не больше 10 файлов')
    await wrapper.get('button[aria-label="Убрать photo-0.png"]').trigger('click')
    Object.defineProperty(mediaInput.element, 'files', { configurable: true, value: [overflow] })
    await mediaInput.trigger('change')
    expect(wrapper.text()).toContain('10 из 10')
    await wrapper.get('form').trigger('submit')
    expect(sendMessage).toHaveBeenCalledWith('', expect.arrayContaining([
      expect.objectContaining({ name: 'photo-1.png', body: photos[1] }),
      expect.objectContaining({ name: 'clip.mp4', body: video }),
      expect.objectContaining({ name: 'archive.yvwhatever', body: arbitrary }),
      expect.objectContaining({ name: 'overflow.png', body: overflow }),
    ]))
    expect(sendMessage.mock.calls[0]?.[1]).toHaveLength(10)
    expect(wrapper.text()).not.toContain('photo-1.png')

    await wrapper.setProps({ conversation })
    expect(wrapper.get<HTMLInputElement>('input[data-picker="media"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLInputElement>('input[data-picker="sticker"]').element.disabled).toBe(true)
    expect(wrapper.get<HTMLInputElement>('input[data-picker="file"]').element.disabled).toBe(true)
  })

  it('sends a local GIF as sticker presentation and gives semantic feedback', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const sendMessage = vi.fn().mockResolvedValue(true)
    const haptic = vi.fn()
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: { ...conversation, conversationType: 'group', title: 'Team' },
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Группа без E2EE',
        sendMessage,
        haptic,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })
    const input = wrapper.get<HTMLInputElement>('input[data-picker="sticker"]')
    const sticker = new File(['party'], 'party.gif', { type: 'image/gif' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [sticker] })
    await input.trigger('change')

    expect(wrapper.get('.composer-attachment').classes()).toContain('composer-attachment--sticker')
    expect(haptic).toHaveBeenCalledWith('selection')
    await wrapper.get('form').trigger('submit')
    expect(sendMessage).toHaveBeenCalledWith('', [{
      name: 'party.gif',
      type: 'image/gif',
      size: sticker.size,
      body: sticker,
      presentation: 'sticker',
    }])
  })

  it('adds clipboard and drag-drop files in order without intercepting ordinary text paste', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name || 'clipboard'}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    const sendMessage = vi.fn().mockResolvedValue(true)
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: { ...conversation, conversationType: 'group', title: 'Team' },
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Группа без E2EE',
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
    const panel = wrapper.get('.message-panel').element
    const textarea = wrapper.get('textarea').element
    const clipboardImage = new File(['image'], '', { type: 'image/png' })
    const pasteFile = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteFile, 'clipboardData', {
      value: {
        items: [{ kind: 'file', getAsFile: () => clipboardImage }],
        files: [],
      },
    })
    textarea.dispatchEvent(pasteFile)
    await wrapper.vm.$nextTick()

    expect(pasteFile.defaultPrevented).toBe(true)
    expect(wrapper.text()).toContain('Вставленное изображение.png')

    const pasteText = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteText, 'clipboardData', {
      value: {
        items: [{ kind: 'string', getAsFile: () => null }],
        files: [],
      },
    })
    textarea.dispatchEvent(pasteText)
    expect(pasteText.defaultPrevented).toBe(false)

    const droppedFile = new File(['document'], 'notes.pdf', { type: 'application/pdf' })
    const transfer = { types: ['Files'], files: [droppedFile], dropEffect: 'none' }
    const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true })
    Object.defineProperty(dragEnter, 'dataTransfer', { value: transfer })
    panel.dispatchEvent(dragEnter)
    await wrapper.vm.$nextTick()
    expect(dragEnter.defaultPrevented).toBe(true)
    expect(wrapper.text()).toContain('Перетащите файлы в сообщение')

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOver, 'dataTransfer', { value: transfer })
    panel.dispatchEvent(dragOver)
    expect(dragOver.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe('copy')

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: transfer })
    panel.dispatchEvent(drop)
    await wrapper.vm.$nextTick()
    expect(drop.defaultPrevented).toBe(true)
    expect(wrapper.text()).not.toContain('Перетащите файлы в сообщение')
    expect(wrapper.text()).toContain('notes.pdf')

    await wrapper.get('form').trigger('submit')
    expect(sendMessage).toHaveBeenCalledWith('', [
      expect.objectContaining({ name: 'Вставленное изображение.png', body: clipboardImage }),
      expect.objectContaining({ name: 'notes.pdf', body: droppedFile }),
    ])
  })

  it('sends video-note metadata in group and only exposes direct capture after E2EE is ready', async () => {
    const body = new Blob(['compact'], { type: 'video/webm' })
    const sendMessage = vi.fn().mockResolvedValue(true)
    const videoNoteRecorder = {
      isSupported: () => true,
      open: vi.fn(),
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: { ...conversation, conversationType: 'group', title: 'Team' },
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Группа без E2EE',
        videoNoteRecorder,
        sendMessage,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
      global: {
        stubs: {
          VideoNoteCapture: {
            template: '<button class="fake-video-note" type="button" @click="$emit(\'recorded\', recording)">record</button>',
            props: ['recorder', 'disabled'],
            emits: ['recorded', 'error'],
            data: () => ({
              recording: { body, contentType: 'video/webm', durationSeconds: 8 },
            }),
          },
        },
      },
    })

    await wrapper.get('.fake-video-note').trigger('click')
    expect(sendMessage).toHaveBeenCalledWith('', [expect.objectContaining({
      type: 'video/webm',
      size: body.size,
      body,
      presentation: 'video_note',
      durationSeconds: 8,
    })])
    await wrapper.setProps({ conversation })
    expect(wrapper.find('.fake-video-note').exists()).toBe(false)
    await wrapper.setProps({ protectionSecure: true })
    expect(wrapper.find('.fake-video-note').exists()).toBe(true)
  })

  it('accepts pasted files only when direct-chat E2EE is ready', async () => {
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'Защищено',
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
    const pasted = new File(['secret'], 'secret.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [], files: [pasted] },
    })
    wrapper.get('textarea').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.text()).toContain('хранение до 30 дней · E2EE')
    expect(wrapper.find('.composer-attachment').exists()).toBe(true)

    await wrapper.setProps({ protectionSecure: false })
    await wrapper.get('.composer-attachment button').trigger('click')
    const blocked = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(blocked, 'clipboardData', {
      value: { items: [], files: [pasted] },
    })
    wrapper.get('textarea').element.dispatchEvent(blocked)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Вложения доступны после готовности E2EE этого личного чата')
    expect(wrapper.find('.composer-attachment').exists()).toBe(false)
  })

  it('renders aggregate and per-item byte progress for a mixed attachment batch', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: { ...conversation, conversationType: 'group', title: 'Team' },
        messages: [],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Группа без E2EE',
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
    const fileInput = wrapper.get<HTMLInputElement>('input[data-picker="file"]')
    const files = [
      new File(['x'.repeat(100)], 'first.bin'),
      new File(['x'.repeat(200)], 'second.bin'),
      new File(['x'.repeat(300)], 'third.bin'),
    ]
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: files })
    await fileInput.trigger('change')
    await wrapper.setProps({
      sending: true,
      attachmentUploadCompleted: 1,
      attachmentUploadTotal: 3,
      attachmentUploadBytesSent: 150,
      attachmentUploadBytesTotal: 600,
    })

    expect(wrapper.text()).toContain('Загрузка 25% · 2 из 3')
    const progress = wrapper.findAll<HTMLElement>('.composer-attachment__progress')
    expect(progress.map(item => item.attributes('aria-valuenow'))).toEqual(['100', '25', '0'])
    expect(progress.map(item => item.attributes('aria-label'))).toEqual([
      'Загрузка first.bin',
      'Загрузка second.bin',
      'Загрузка third.bin',
    ])
    expect(wrapper.get('button[aria-label="Убрать second.bin"]').attributes('disabled')).toBe('')

    await wrapper.setProps({
      attachmentUploadCompleted: 3,
      attachmentUploadBytesSent: 600,
    })
    expect(wrapper.text()).toContain('Сохраняем сообщение… 100%')
    expect(wrapper.findAll('.composer-attachment__progress').map(
      item => item.attributes('aria-valuenow'),
    )).toEqual(['100', '100', '100'])
  })

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
    expect(wrapper.text()).toContain('Состояние диалога изменилось')
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

    await wrapper.get('[data-message-id="message-1"]').trigger('contextmenu', {
      clientX: 120,
      clientY: 140,
    })
    await wrapper.get('.context-message-actions button.danger').trigger('click')
    expect(deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('без возможности восстановления')
    await wrapper.get('.message-confirm-dialog button.danger').trigger('click')
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
    await wrapper.get('[data-message-id="message-1"]').trigger('contextmenu')
    expect(wrapper.find('.message-context-menu').exists()).toBe(false)
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

  it('restores an exact message target and persists a message-relative viewport anchor', async () => {
    const saveViewport = vi.fn().mockResolvedValue(undefined)
    const message = {
      messageId: 'message-target',
      clientMessageId: 'client-target',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      sequence: 7,
      createdAt: '2026-08-11T12:07:00Z',
      expiresAt: '2026-09-10T12:07:00Z',
      ciphertextBase64: 'aGVsbG8=',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'target',
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [message],
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
        saveViewport,
      },
    })
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    const bubble = wrapper.get('[data-message-id="message-target"]').element as HTMLElement
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 600, writable: true },
      scrollTo: { configurable: true, value: vi.fn() },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ top: 100, bottom: 500, height: 400, left: 0, right: 300, width: 300, x: 0, y: 100, toJSON() {} }),
      },
    })
    Object.defineProperty(bubble, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 310, bottom: 350, height: 40, left: 0, right: 200, width: 200, x: 0, y: 310, toJSON() {} }),
    })

    await wrapper.setProps({ targetMessageId: 'message-target' })
    await vi.waitFor(() => expect(timeline.scrollTop).toBe(630))
    expect(wrapper.get('[data-message-id="message-target"]').classes()).toContain('targeted')

    wrapper.unmount()
    expect(saveViewport).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      messageId: 'message-target',
      sequence: 7,
      offset: 210,
      atLatest: false,
    }))
  })

  it('keeps a 1000-message live tail across real settings KeepAlive deactivation', async () => {
    const messages = Array.from({ length: 1_000 }, (_, index) => {
      const sequence = index + 1
      return {
        messageId: `stress-message-${sequence}`,
        clientMessageId: `stress-client-${sequence}`,
        conversationId: 'conversation-1',
        senderUserId: sequence % 2 === 0 ? 'alice-id' : 'bob-id',
        senderDeviceId: sequence % 2 === 0 ? 'alice-device' : 'bob-device',
        protocolVersion: 1 as const,
        sequence,
        createdAt: new Date(Date.UTC(2026, 7, 11, 12, 0, sequence)).toISOString(),
        expiresAt: '2026-09-10T12:00:00Z',
        ciphertextBase64: 'b3BhcXVl',
        deletionReason: null,
        deletedAt: null,
        contentState: 'available' as const,
        displayBody: `stress ${sequence}`,
        contentSecure: false,
      }
    })
    const savedAnchor = ref<ConversationViewportAnchor | null>(null)
    const saveViewport = vi.fn(async anchor => {
      savedAnchor.value = anchor
    })
    const props = {
      conversation,
      messages,
      actorUserId: 'alice-id',
      sending: false,
      protectionSecure: false,
      protectionLabel: 'Тестовый режим без E2EE',
      sendMessage: vi.fn(),
      deleteMessage: vi.fn(),
      deletingMessageId: null,
      typingActorIds: [] as string[],
      onlineActorIds: [] as string[],
      deliveryStates: [],
      connectionState: 'connected' as const,
      setTyping: vi.fn(),
      saveViewport,
    }
    const visible = ref(true)
    const visibleMessages = ref(messages)
    const host = defineComponent({
      setup() {
        return () => h(KeepAlive, null, {
          default: () => visible.value
            ? h(MessagePanel, {
                key: 'kept-chat',
                ...props,
                messages: visibleMessages.value,
                viewportAnchor: savedAnchor.value,
              })
            : h('section', { class: 'settings-fixture' }, 'Настройки'),
        })
      },
    })
    const wrapper = mount(host)
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    let scrollHeight = 50_000
    const scrollTo = vi.fn(({ top }: { top: number }) => {
      timeline.scrollTop = Math.max(0, top - timeline.clientHeight)
    })
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 49_600, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    })

    await wrapper.get('.message-timeline').trigger('scroll')
    visible.value = false
    await nextTick()
    await vi.waitFor(() => expect(savedAnchor.value).toMatchObject({
      messageId: 'stress-message-1000',
      sequence: 1_000,
      atLatest: true,
    }))

    const newest = {
      ...messages.at(-1)!,
      messageId: 'stress-message-1001',
      clientMessageId: 'stress-client-1001',
      sequence: 1_001,
      displayBody: 'stress 1001',
    }
    // Reproduce WebKit resetting the detached cached scroll element while the
    // Settings page owns the viewport.
    timeline.scrollTop = 0
    scrollHeight = 50_050
    visibleMessages.value = [...messages, newest]
    scrollTo.mockClear()
    visible.value = true
    await nextTick()
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledWith({
      top: 50_050,
      behavior: 'auto',
    }))
    expect(timeline.scrollTop).toBe(49_650)
    expect(wrapper.find('.scroll-to-latest').exists()).toBe(false)
    expect(wrapper.get('[data-message-id="stress-message-1001"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('loads the authoritative latest window before restoring a saved live-tail intent', async () => {
    const returnToLatest = vi.fn().mockResolvedValue(undefined)
    const message = {
      messageId: 'stale-tail-message',
      clientMessageId: 'stale-tail-client',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1 as const,
      sequence: 900,
      createdAt: '2026-08-11T12:09:00Z',
      expiresAt: '2026-09-10T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'stale tail',
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [message],
        historyHasNewer: true,
        returnToLatest,
        viewportAnchor: {
          conversationId: 'conversation-1',
          messageId: 'stale-tail-message',
          sequence: 900,
          offset: 280,
          atLatest: true,
          savedAt: '2026-08-11T12:10:00Z',
        },
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
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    })

    await wrapper.get('.message-timeline').trigger('scroll')
    await vi.waitFor(() => expect(returnToLatest).toHaveBeenCalledOnce())
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: 'auto' })
    wrapper.unmount()
  })

  it('prefers the actual bottom position over an older debounced scroll capture on unmount', async () => {
    const saveViewport = vi.fn().mockResolvedValue(undefined)
    const messages = [1, 2].map(sequence => ({
      messageId: `boundary-message-${sequence}`,
      clientMessageId: `boundary-client-${sequence}`,
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1 as const,
      sequence,
      createdAt: `2026-08-11T12:00:0${sequence}Z`,
      expiresAt: '2026-09-10T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: `boundary ${sequence}`,
      contentSecure: false,
    }))
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages,
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
        saveViewport,
      },
    })
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 200, writable: true },
      scrollTo: { configurable: true, value: vi.fn() },
    })

    await wrapper.get('.message-timeline').trigger('scroll')
    timeline.scrollTop = 800
    wrapper.unmount()

    expect(saveViewport).toHaveBeenLastCalledWith(expect.objectContaining({
      messageId: 'boundary-message-2',
      sequence: 2,
      atLatest: true,
    }))
  })

  it('waits for a deep-linked message instead of falling back to the end of stale history', async () => {
    const staleMessage = {
      messageId: 'message-stale',
      clientMessageId: 'client-stale',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      sequence: 1_000,
      createdAt: '2026-08-11T12:00:00Z',
      expiresAt: '2026-09-10T12:00:00Z',
      ciphertextBase64: 'c3RhbGU=',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'stale',
      contentSecure: false,
    }
    const targetMessage = {
      ...staleMessage,
      messageId: 'message-target-later',
      clientMessageId: 'client-target-later',
      sequence: 500,
      displayBody: 'target',
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [staleMessage],
        targetMessageId: 'message-target-later',
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
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ top: 100, bottom: 500, height: 400, left: 0, right: 300, width: 300, x: 0, y: 100, toJSON() {} }),
      },
    })

    await wrapper.setProps({ targetMessageId: 'message-target-later' })
    expect(wrapper.get('.message-timeline').classes()).toContain('message-timeline--restoring')
    expect(scrollTo).not.toHaveBeenCalled()

    await wrapper.setProps({ messages: [targetMessage] })
    const target = wrapper.get('[data-message-id="message-target-later"]').element as HTMLElement
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 310, bottom: 350, height: 40, left: 0, right: 200, width: 200, x: 0, y: 310, toJSON() {} }),
    })
    await wrapper.setProps({ messages: [{ ...targetMessage }] })
    await vi.waitFor(() => expect(timeline.scrollTop).toBe(30))
    expect(wrapper.get('.message-timeline').classes()).not.toContain('message-timeline--restoring')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('does not overwrite a saved anchor while the mobile conversation pane is hidden', async () => {
    const saveViewport = vi.fn().mockResolvedValue(undefined)
    const hiddenMessage = {
      messageId: 'message-hidden',
      clientMessageId: 'client-hidden',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      sequence: 945,
      createdAt: '2026-08-11T12:45:00Z',
      expiresAt: '2026-09-10T12:45:00Z',
      ciphertextBase64: 'aGVsbG8=',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'hidden pane anchor',
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [hiddenMessage],
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
        viewportAnchor: {
          conversationId: 'conversation-1',
          messageId: 'message-hidden',
          sequence: 945,
          offset: -18,
          atLatest: false,
          savedAt: '2026-08-11T12:45:30Z',
        },
        saveViewport,
      },
    })
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    Object.defineProperties(timeline, {
      clientHeight: { configurable: true, value: 0 },
      scrollHeight: { configurable: true, value: 9_000 },
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollTo: { configurable: true, value: vi.fn() },
    })

    await wrapper.vm.$nextTick()
    expect(wrapper.get('.message-timeline').classes()).toContain('message-timeline--restoring')
    wrapper.unmount()
    expect(saveViewport).not.toHaveBeenCalled()
  })

  it('captures the previous chat viewport before a debounced save can be lost on switch', async () => {
    const saveViewport = vi.fn().mockResolvedValue(undefined)
    const firstMessage = {
      messageId: 'message-first',
      clientMessageId: 'client-first',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      sequence: 9,
      createdAt: '2026-08-11T12:09:00Z',
      expiresAt: '2026-09-10T12:09:00Z',
      ciphertextBase64: 'Zmlyc3Q=',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'first',
      contentSecure: false,
    }
    const secondConversation = {
      ...conversation,
      conversationId: 'conversation-2',
      title: 'Second group',
    }
    const secondMessage = {
      ...firstMessage,
      messageId: 'message-second',
      clientMessageId: 'client-second',
      conversationId: 'conversation-2',
      sequence: 3,
      displayBody: 'second',
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
        saveViewport,
      },
    })
    const timeline = wrapper.get('.message-timeline').element as HTMLElement
    const bubble = wrapper.get('[data-message-id="message-first"]').element as HTMLElement
    Object.defineProperties(timeline, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 300, writable: true },
      scrollTo: { configurable: true, value: vi.fn() },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ top: 100, bottom: 500, height: 400, left: 0, right: 300, width: 300, x: 0, y: 100, toJSON() {} }),
      },
    })
    Object.defineProperty(bubble, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 220, bottom: 260, height: 40, left: 0, right: 200, width: 200, x: 0, y: 220, toJSON() {} }),
    })
    saveViewport.mockClear()

    await wrapper.get('.message-timeline').trigger('scroll')
    await wrapper.setProps({
      conversation: secondConversation,
      messages: [secondMessage],
    })

    expect(saveViewport).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      messageId: 'message-first',
      sequence: 9,
      offset: 120,
      atLatest: false,
    }))
    wrapper.unmount()
  })
  it('shows every eligible mention in a scrollable list without taking over the composer grid', async () => {
    const groupMembers = [
      conversation.members[0]!,
      ...Array.from({ length: 11 }, (_, index) => ({
        userId: `member-${index}`,
        username: `member${index}`,
        displayName: `Member ${index}`,
        role: 'member' as const,
        joinedAt: '2026-08-11T12:00:00Z',
        leftAt: null,
      })),
      {
        userId: 'former-member',
        username: 'former',
        displayName: 'Former member',
        role: 'member' as const,
        joinedAt: '2026-08-11T12:00:00Z',
        leftAt: '2026-08-12T12:00:00Z',
      },
    ]
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: {
          ...conversation,
          conversationType: 'group',
          title: 'Team',
          members: groupMembers,
        },
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

    const textarea = wrapper.get('textarea')
    await textarea.setValue('@')

    const options = wrapper.findAll('.mention-suggestions [role="option"]')
    expect(options).toHaveLength(11)
    expect(wrapper.find('.mention-suggestions').attributes('role')).toBe('listbox')
    expect(wrapper.findAll('.mention-suggestions__avatar')).toHaveLength(11)
    expect(textarea.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).not.toContain('@former')

    await textarea.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.findAll('.mention-suggestions [aria-selected="true"]')[0]?.text())
      .toContain('Member 1')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect((textarea.element as HTMLTextAreaElement).value).toBe('@member1 ')
    expect(wrapper.find('.mention-suggestions').exists()).toBe(false)
  })

  it('searches, replies, mentions and toggles reactions without exposing message text to search API', async () => {
    const message = {
      messageId: 'message-1',
      clientMessageId: 'client-1',
      conversationId: 'conversation-1',
      senderUserId: 'bob-id',
      senderDeviceId: 'bob-device',
      protocolVersion: 1,
      cryptoGenerationId: null,
      cryptoEpoch: null,
      sequence: 1,
      createdAt: '2026-08-11T12:00:00Z',
      expiresAt: '2026-09-10T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'Нужное сообщение',
      contentSecure: true,
    }
    const sendMessage = vi.fn().mockResolvedValue(true)
    const searchMessages = vi.fn().mockResolvedValue([message])
    const openMessage = vi.fn().mockResolvedValue(undefined)
    const toggleReaction = vi.fn().mockResolvedValue(true)
    const haptic = vi.fn()
    const wrapper = mount(MessagePanel, {
      props: {
        conversation,
        messages: [message],
        actorUserId: 'alice-id',
        sending: false,
        protectionSecure: true,
        protectionLabel: 'MLS E2EE',
        sendMessage,
        searchMessages,
        openMessage,
        reactionSummaries: [{
          messageId: 'message-1',
          reaction: '❤️',
          count: 2,
          reactedByActor: true,
          actorUserIds: ['alice-id', 'bob-id'],
        }],
        toggleReaction,
        haptic,
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    await wrapper.get('button[aria-label="Поиск по чату"]').trigger('click')
    await wrapper.get('#chat-search-input').setValue('нужное')
    await wrapper.get('.chat-search').trigger('submit')
    expect(searchMessages).toHaveBeenCalledWith('нужное')
    expect(openMessage).toHaveBeenCalledWith('message-1')

    await wrapper.get('[data-message-id="message-1"]').trigger('contextmenu', {
      clientX: 120,
      clientY: 140,
    })
    expect(wrapper.findAll('.context-reaction-actor')).toHaveLength(2)
    expect(wrapper.get('.context-reaction-details').text()).toContain('❤️Alice@alice')
    expect(wrapper.get('.context-reaction-details').text()).toContain('❤️Bob@bob')
    await wrapper.get('.context-message-actions button').trigger('click')
    expect(wrapper.text()).toContain('Ответ Bob')
    await wrapper.get('textarea').setValue('Привет @b')
    expect(wrapper.text()).toContain('@bob')
    await wrapper.get('.mention-suggestions button').trigger('click')
    await wrapper.get('form.composer').trigger('submit')
    expect(sendMessage).toHaveBeenCalledWith('Привет @bob ', undefined, {
      replyToMessageId: 'message-1',
      mentionedUserIds: ['bob-id'],
    })

    await wrapper.get('.message-reactions button').trigger('click')
    expect(toggleReaction).toHaveBeenCalledWith('message-1', '❤️', false)
    expect(haptic).toHaveBeenCalledWith('selection')
    await wrapper.get('[data-message-id="message-1"]').trigger('contextmenu', {
      clientX: 120,
      clientY: 140,
    })
    await wrapper.get('.context-reactions-expand').trigger('click')
    expect(wrapper.findAll('.context-all-reactions button')).toHaveLength(48)
    await wrapper.get('button[aria-label="Реакция 🥰"]').trigger('click')
    expect(toggleReaction).toHaveBeenCalledWith('message-1', '🥰', true)
    expect(haptic).toHaveBeenCalledWith('success')
    expect(wrapper.get('.reaction-burst').text()).toContain('🥰')
  })

  it('keeps many group reaction actors in a bounded scrollable footer', async () => {
    const members = Array.from({ length: 12 }, (_, index) => ({
      userId: `member-${index}`,
      username: `member${index}`,
      displayName: `Member ${index}`,
      role: index === 0 ? 'owner' as const : 'member' as const,
      joinedAt: '2026-08-11T12:00:00Z',
      leftAt: null,
    }))
    const message = {
      messageId: 'group-message',
      clientMessageId: 'group-client',
      conversationId: 'group-conversation',
      senderUserId: 'member-1',
      senderDeviceId: 'member-device',
      protocolVersion: 1,
      cryptoGenerationId: null,
      cryptoEpoch: null,
      sequence: 1,
      createdAt: '2026-08-11T12:00:00Z',
      expiresAt: '2027-08-11T12:00:00Z',
      ciphertextBase64: 'b3BhcXVl',
      deletionReason: null,
      deletedAt: null,
      contentState: 'available' as const,
      displayBody: 'Group reaction details',
      contentSecure: false,
    }
    const wrapper = mount(MessagePanel, {
      props: {
        conversation: {
          ...conversation,
          conversationId: 'group-conversation',
          conversationType: 'group' as const,
          title: 'Team',
          createdBy: 'member-0',
          members,
        },
        messages: [message],
        actorUserId: 'member-0',
        sending: false,
        protectionSecure: false,
        protectionLabel: 'Без E2EE',
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        deletingMessageId: null,
        typingActorIds: [],
        onlineActorIds: [],
        deliveryStates: [],
        reactionSummaries: [{
          messageId: 'group-message',
          reaction: '🔥',
          count: 12,
          reactedByActor: true,
          actorUserIds: members.map(member => member.userId),
        }],
        connectionState: 'connected',
        setTyping: vi.fn(),
      },
    })

    expect(wrapper.find('.context-reaction-details').exists()).toBe(false)
    await wrapper.get('[data-message-id="group-message"]').trigger('contextmenu', {
      clientX: 120,
      clientY: 140,
    })
    expect(wrapper.findAll('.context-reaction-actor')).toHaveLength(12)
    expect(wrapper.get('.context-reaction-actors').attributes('role')).toBe('list')
    expect(wrapper.get('.context-reaction-details').text()).toContain('🔥Member 11@member11')
  })
})
