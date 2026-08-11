import { describe, expect, it } from 'vitest'

import { ApplicationError } from '../app/application/errors'
import { syntheticMessageCodec } from '../app/infrastructure/crypto/synthetic-message-codec'
import { parseConversation, parseSyncPage } from '../app/infrastructure/http/messaging-parsers'
import { parseConversationReadStates } from '../app/infrastructure/http/conversation-read-state-parsers'

const conversation = {
  conversation_id: 'conversation-1',
  conversation_type: 'direct',
  title: null,
  created_by: 'user-1',
  created_at: '2026-08-11T12:00:00Z',
  updated_at: '2026-08-11T12:00:00Z',
  members: [{
    user_id: 'user-1',
    username: 'alice',
    display_name: 'Alice',
    role: 'member',
    joined_at: '2026-08-11T12:00:00Z',
    left_at: null,
  }],
}

describe('messaging boundaries', () => {
  it('parses the explicit conversation shape and rejects an unknown enum', () => {
    expect(parseConversation(conversation).conversationType).toBe('direct')
    expect(() => parseConversation({ ...conversation, conversation_type: 'channel' }))
      .toThrow(ApplicationError)
  })

  it('rejects a malformed sync cursor', () => {
    expect(() => parseSyncPage({
      events: [],
      next_cursor: -1,
      stream_cursor: 0,
      has_more: false,
      reset_required: false,
    })).toThrow(ApplicationError)
    expect(() => parseSyncPage({
      events: [{
        event_id: 'event-1',
        cursor: 1,
        event_type: 'read_receipt',
        conversation_id: 'conversation-1',
        message_id: null,
        actor_user_id: null,
        read_sequence: 2,
        created_at: '2026-08-11T12:00:00Z',
      }],
      next_cursor: 1,
      stream_cursor: 1,
      has_more: false,
      reset_required: false,
    })).toThrow(ApplicationError)
  })

  it('labels the temporary codec as insecure and round-trips unicode', () => {
    const plaintext = 'Привет 👋'
    expect(syntheticMessageCodec.secure).toBe(false)
    expect(syntheticMessageCodec.decode(syntheticMessageCodec.encode(plaintext))).toBe(plaintext)
  })

  it('parses bounded read summaries and rejects negative counts', () => {
    expect(parseConversationReadStates([{
      conversation_id: 'conversation-1',
      last_read_sequence: 2,
      latest_sequence: 4,
      unread_count: 2,
    }])).toEqual([{
      conversationId: 'conversation-1',
      lastReadSequence: 2,
      latestSequence: 4,
      unreadCount: 2,
    }])
    expect(() => parseConversationReadStates([{
      conversation_id: 'conversation-1',
      last_read_sequence: 0,
      latest_sequence: 0,
      unread_count: -1,
    }])).toThrow(ApplicationError)
  })
})
