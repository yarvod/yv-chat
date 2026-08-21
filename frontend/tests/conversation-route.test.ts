import { describe, expect, it } from 'vitest'

import {
  nativeNavigationTarget,
  notificationNavigationTarget,
  selectedConversationId,
  selectedMessageId,
} from '../app/presentation/chat/conversation-route'

describe('conversation route state', () => {
  it('accepts one non-empty id and rejects absent, empty, or repeated query values', () => {
    expect(selectedConversationId('conversation-1')).toBe('conversation-1')
    expect(selectedConversationId(undefined)).toBeNull()
    expect(selectedConversationId('')).toBeNull()
    expect(selectedConversationId(['conversation-1', 'conversation-2'])).toBeNull()
  })

  it('parses an optional exact-message target with the same single-value rules', () => {
    expect(selectedMessageId('message-1')).toBe('message-1')
    expect(selectedMessageId(undefined)).toBeNull()
    expect(selectedMessageId(['message-1', 'message-2'])).toBeNull()
  })

  it('accepts only a typed notification navigation with UUID targets', () => {
    const conversationId = 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e'
    const messageId = '7befbd28-1b77-48ee-8b6c-6f279fc1b92e'
    expect(notificationNavigationTarget({
      type: 'yv-notification-navigation',
      conversationId,
      messageId,
    })).toEqual({ conversationId, messageId })
    expect(notificationNavigationTarget({
      type: 'yv-notification-navigation',
      conversationId,
      messageId: 'not-a-uuid',
    })).toBeNull()
    expect(notificationNavigationTarget({
      type: 'unexpected',
      conversationId,
      messageId,
    })).toBeNull()
  })

  it('accepts only the bounded native deep-link route', () => {
    const conversationId = 'd2e0a3c9-3dcc-4737-a7c9-1fbffd28c84e'
    const messageId = '7befbd28-1b77-48ee-8b6c-6f279fc1b92e'

    expect(nativeNavigationTarget(
      `yvchat://chat/${conversationId}?message=${messageId}`,
    )).toEqual({ conversationId, messageId })
    expect(nativeNavigationTarget(`https://chat/${conversationId}?message=${messageId}`))
      .toBeNull()
    expect(nativeNavigationTarget(`yvchat://chat/${conversationId}?message=bad`)).toBeNull()
    expect(nativeNavigationTarget(`yvchat://chat/${conversationId}`)).toEqual({ conversationId })
  })
})
