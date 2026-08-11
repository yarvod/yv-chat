import { describe, expect, it } from 'vitest'

import { ApiError } from '../app/services/api'
import { parseConversation, parseSyncPage } from '../app/services/messaging/parsers'
import { syntheticMessageCodec } from '../app/services/messaging/syntheticCodec'

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
      .toThrow(ApiError)
  })

  it('rejects a malformed sync cursor', () => {
    expect(() => parseSyncPage({
      events: [],
      next_cursor: -1,
      stream_cursor: 0,
      has_more: false,
      reset_required: false,
    })).toThrow(ApiError)
  })

  it('labels the temporary codec as insecure and round-trips unicode', () => {
    const plaintext = 'Привет 👋'
    expect(syntheticMessageCodec.secure).toBe(false)
    expect(syntheticMessageCodec.decode(syntheticMessageCodec.encode(plaintext))).toBe(plaintext)
  })
})
