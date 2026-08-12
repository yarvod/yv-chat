import { describe, expect, it } from 'vitest'

import {
  decodeTextMessageContent,
  encodeTextMessageContent,
} from '../app/application/messaging/text-message-content'
import {
  decodeGroupMessageContent,
  encodeGroupMessageContent,
} from '../app/application/messaging/group-message-content'

describe('protected message interaction content', () => {
  it('round-trips reply and mention metadata while preserving legacy direct text', () => {
    const encoded = encodeTextMessageContent({
      text: 'Ответ @bob',
      replyToMessageId: 'message-1',
      mentionedUserIds: ['bob-id'],
    })

    expect(decodeTextMessageContent(encoded)).toEqual({
      text: 'Ответ @bob',
      replyToMessageId: 'message-1',
      mentionedUserIds: ['bob-id'],
    })
    expect(encodeTextMessageContent({
      text: 'legacy-compatible',
      replyToMessageId: null,
      mentionedUserIds: [],
    })).toBe('legacy-compatible')
    expect(decodeTextMessageContent('old raw text')).toEqual({
      text: 'old raw text',
      replyToMessageId: null,
      mentionedUserIds: [],
    })
  })

  it('carries the same interaction metadata beside group attachment content', () => {
    const encoded = encodeGroupMessageContent({
      text: 'group reply @bob',
      attachments: [],
      replyToMessageId: 'message-2',
      mentionedUserIds: ['bob-id'],
    })
    expect(decodeGroupMessageContent(encoded)).toEqual({
      text: 'group reply @bob',
      attachments: [],
      replyToMessageId: 'message-2',
      mentionedUserIds: ['bob-id'],
    })
  })

  it('normalizes duplicate mentions and rejects malformed interaction identifiers', () => {
    expect(() => encodeTextMessageContent({
      text: 'hello',
      replyToMessageId: 'bad id',
      mentionedUserIds: [],
    })).toThrow(TypeError)
    const normalized = encodeTextMessageContent({
      text: 'hello',
      replyToMessageId: null,
      mentionedUserIds: ['same', 'same'],
    })
    expect(decodeTextMessageContent(normalized).mentionedUserIds).toEqual(['same'])
  })
})
