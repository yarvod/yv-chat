import { describe, expect, it } from 'vitest'

import { selectedConversationId } from '../app/presentation/chat/conversation-route'

describe('conversation route state', () => {
  it('accepts one non-empty id and rejects absent, empty, or repeated query values', () => {
    expect(selectedConversationId('conversation-1')).toBe('conversation-1')
    expect(selectedConversationId(undefined)).toBeNull()
    expect(selectedConversationId('')).toBeNull()
    expect(selectedConversationId(['conversation-1', 'conversation-2'])).toBeNull()
  })
})
