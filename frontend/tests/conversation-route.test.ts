import { describe, expect, it } from 'vitest'

import {
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
})
